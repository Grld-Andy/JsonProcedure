import sql from 'mssql';
import { Db, type ResultSet } from './db.ts';
import { ApiError, isoLocal, type Body } from './errors.ts';
import type { LogSink } from './log.ts';
import type { UserStore } from './userStore.ts';

export interface ProcedureSummary { schema: string; name: string; created: string; modified: string; parameterCount: number }
export interface ProcedureParameter { name: string; type: string; isOutput: boolean; hasDefault: boolean }
export interface ProcedureDetail {
  schema: string; name: string; definition: string | null; isEncrypted: boolean; parameters: ProcedureParameter[];
}
export interface ExecutionResult {
  resultSets: ResultSet[];
  outputParameters: Record<string, unknown>;
  returnValue: number | null;
  rowsAffected: number;
  elapsedMs: number;
}

type Row = Record<string, unknown>;

/** Everything needed to bind one parameter, from sys.parameters. */
interface ParamMeta extends ProcedureParameter {
  base: string;          // underlying system type name
  maxLength: number;
  precision: number;
  scale: number;
  isTableType: boolean;
}

const GO_RX = /^\s*GO\s*$/gim;
const PROC_RX =
  /^\s*CREATE\s+(OR\s+ALTER\s+)?PROC(EDURE)?\s+((\[[^\]]+\]|\w+)\s*\.\s*)?(\[[^\]]+\]|\w+)|^\s*ALTER\s+PROC(EDURE)?\s+((\[[^\]]+\]|\w+)\s*\.\s*)?(\[[^\]]+\]|\w+)/i;
const COMMENT_RX = /(--[^\r\n]*)|(\/\*.*?\*\/)/gs;
const GUID_RX = /^\{?[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}\}?$/i;
const ISO_RX = /^(\d{4}-\d{2}-\d{2})(?:[T ](\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?))?$/;
const HISTORY_ROWS_PER_SET = 100;

function formatParamType(p: { type: string; maxLength: number; precision: number; scale: number }): string {
  switch (p.type) {
    case 'nvarchar': case 'nchar': return `${p.type}(${p.maxLength === -1 ? 'max' : p.maxLength / 2})`;
    case 'varchar': case 'char': case 'varbinary': case 'binary': return `${p.type}(${p.maxLength === -1 ? 'max' : p.maxLength})`;
    case 'decimal': case 'numeric': return `${p.type}(${p.precision},${p.scale})`;
    default: return p.type;
  }
}

/** The mssql parameter type for a SQL Server system type. */
function mssqlType(p: ParamMeta): sql.ISqlType | (() => sql.ISqlType) {
  const len = p.maxLength === -1 ? sql.MAX : p.maxLength;
  switch (p.base) {
    case 'int': return sql.Int;
    case 'bigint': return sql.BigInt;
    case 'smallint': return sql.SmallInt;
    case 'tinyint': return sql.TinyInt;
    case 'bit': return sql.Bit;
    case 'float': return sql.Float;
    case 'real': return sql.Real;
    case 'money': return sql.Money;
    case 'smallmoney': return sql.SmallMoney;
    case 'decimal': return sql.Decimal(p.precision, p.scale);
    case 'numeric': return sql.Numeric(p.precision, p.scale);
    case 'date': return sql.Date;
    case 'datetime': return sql.DateTime;
    case 'smalldatetime': return sql.SmallDateTime;
    case 'datetime2': return sql.DateTime2(p.scale);
    case 'datetimeoffset': return sql.DateTimeOffset(p.scale);
    case 'time': return sql.Time(p.scale);
    case 'uniqueidentifier': return sql.UniqueIdentifier;
    case 'nvarchar': return sql.NVarChar(len === sql.MAX ? sql.MAX : len / 2);
    case 'nchar': return sql.NChar(len === sql.MAX ? 4000 : len / 2);
    case 'varchar': return sql.VarChar(len);
    case 'char': return sql.Char(len === sql.MAX ? 8000 : len);
    case 'varbinary': return sql.VarBinary(len);
    case 'binary': return sql.VarBinary(len === sql.MAX ? 8000 : len); // the driver has no sized Binary; the server pads it
    case 'xml': return sql.Xml;
    case 'text': return sql.Text;
    case 'ntext': return sql.NText;
    case 'image': return sql.Image;
    default: return sql.NVarChar(sql.MAX); // unknown/UDT types: pass text and let the server convert
  }
}

function formatError(name: string, value: string, what: string): ApiError {
  return new ApiError(400, `Parameter format error: '${value}' is not a valid ${what} for @${name}.`);
}

/** A date/time string to a Date whose UTC fields are the wall-clock values (the driver sends UTC as-is). */
function parseWallClock(s: string): Date | null {
  const m = ISO_RX.exec(s.trim());
  if (m) {
    const t = m[2] ? (m[2].length === 5 ? m[2] + ':00' : m[2]) : '00:00:00';
    const d = new Date(`${m[1]}T${t}Z`);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  return /(Z|[+-]\d{2}:?\d{2})$/i.test(s.trim())
    ? d
    : new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes(), d.getSeconds(), d.getMilliseconds()));
}

/** Converts a JSON parameter value to what the driver expects for the declared SQL type. */
function coerce(name: string, raw: unknown, base: string): unknown {
  const v = Db.fromJson(raw);
  if (v === null || typeof v !== 'string') return v;
  switch (base) {
    case 'uniqueidentifier':
      if (!GUID_RX.test(v)) throw formatError(name, v, 'GUID');
      return v.replace(/[{}]/g, '');
    case 'date': case 'datetime': case 'datetime2': case 'smalldatetime': {
      const d = parseWallClock(v);
      if (!d) throw formatError(name, v, 'date/time');
      return d;
    }
    case 'datetimeoffset': {
      const d = new Date(v);
      if (Number.isNaN(d.getTime())) throw formatError(name, v, 'date/time');
      return d;
    }
    case 'time': {
      const m = /^(\d{1,2}):(\d{2})(?::(\d{2})(\.\d+)?)?$/.exec(v.trim());
      if (!m) throw formatError(name, v, 'time');
      return new Date(`1970-01-01T${m[1].padStart(2, '0')}:${m[2]}:${m[3] ?? '00'}${m[4] ?? ''}Z`);
    }
    case 'int': case 'smallint': case 'tinyint': {
      const n = Number(v);
      if (v.trim() === '' || !Number.isInteger(n)) throw formatError(name, v, 'integer');
      return n;
    }
    case 'bigint':
      if (!/^-?\d+$/.test(v.trim())) throw formatError(name, v, 'integer');
      return v.trim();
    case 'decimal': case 'numeric': case 'money': case 'smallmoney': case 'float': case 'real': {
      const n = Number(v);
      if (v.trim() === '' || !Number.isFinite(n)) throw formatError(name, v, 'number');
      return n;
    }
    case 'bit': return /^true$/i.test(v.trim()) ? true : /^false$/i.test(v.trim()) ? false : v.trim() === '1';
    default: return v;
  }
}

export class ProcedureService {
  private readonly db: Db;
  private readonly store: UserStore;
  private readonly log: LogSink;

  constructor(db: Db, store: UserStore, log: LogSink) {
    this.db = db;
    this.store = store;
    this.log = log;
  }

  /** Reads every user-defined stored procedure that already exists in the database. */
  async list(): Promise<ProcedureSummary[]> {
    const r = await this.db.request();
    r.arrayRowMode = false;
    const res = await r.query(`
      SELECT s.name AS schema_name, p.name AS proc_name, p.create_date, p.modify_date,
             (SELECT COUNT(*) FROM sys.parameters x WHERE x.object_id=p.object_id AND x.parameter_id>0) AS param_count
      FROM sys.procedures p JOIN sys.schemas s ON s.schema_id=p.schema_id
      WHERE p.is_ms_shipped=0
      ORDER BY s.name, p.name`);
    return (res.recordset as unknown as Row[]).map((x) => ({
      schema: x.schema_name as string,
      name: x.proc_name as string,
      created: isoLocal(x.create_date as Date),
      modified: isoLocal(x.modify_date as Date),
      parameterCount: Number(x.param_count),
    }));
  }

  private async load(schema: string, name: string): Promise<{ detail: ProcedureDetail; meta: ParamMeta[] }> {
    const full = Db.full(schema, name);
    const idReq = await this.db.request();
    idReq.arrayRowMode = false;
    const idRes = await idReq.input('n', sql.NVarChar(400), full).query("SELECT OBJECT_ID(@n, 'P') AS id");
    const objectId = (idRes.recordset[0] as Row | undefined)?.id as number | null | undefined;
    if (objectId == null) throw new ApiError(404, `Procedure ${schema}.${name} not found.`);

    const defReq = await this.db.request();
    defReq.arrayRowMode = false;
    const defRes = await defReq.input('id', sql.Int, objectId).query('SELECT OBJECT_DEFINITION(@id) AS def');
    const definition = ((defRes.recordset[0] as Row | undefined)?.def as string | null | undefined) ?? null;

    const pReq = await this.db.request();
    pReq.arrayRowMode = false;
    const pRes = await pReq.input('id', sql.Int, objectId).query(`
      SELECT p.name, ty.name AS type_name, TYPE_NAME(ty.system_type_id) AS base_name, ty.is_table_type,
             p.max_length, p.precision, p.scale, p.is_output, p.has_default_value
      FROM sys.parameters p JOIN sys.types ty ON ty.user_type_id=p.user_type_id
      WHERE p.object_id=@id AND p.parameter_id>0 ORDER BY p.parameter_id`);

    const meta: ParamMeta[] = (pRes.recordset as unknown as Row[]).map((x) => {
      const type = x.type_name as string;
      const maxLength = Number(x.max_length);
      const precision = Number(x.precision);
      const scale = Number(x.scale);
      return {
        name: x.name as string,
        type: formatParamType({ type, maxLength, precision, scale }),
        isOutput: !!x.is_output,
        hasDefault: !!x.has_default_value,
        base: ((x.base_name as string | null) ?? type).toLowerCase(),
        maxLength, precision, scale,
        isTableType: !!x.is_table_type,
      };
    });
    const parameters = meta.map(({ name: n, type, isOutput, hasDefault }) => ({ name: n, type, isOutput, hasDefault }));
    return { detail: { schema, name, definition, isEncrypted: definition === null, parameters }, meta };
  }

  async get(schema: string, name: string): Promise<ProcedureDetail> {
    return (await this.load(schema, name)).detail;
  }

  /** Runs a CREATE/ALTER PROCEDURE script against the database. */
  async save(script: string): Promise<void> {
    if (typeof script !== 'string' || !script.trim()) throw new ApiError(400, 'Script is empty.');
    const batches = script.split(GO_RX).filter((b) => b.trim().length > 0);
    for (const b of batches) {
      // Only allow batches that start with CREATE/ALTER PROCEDURE (after comments).
      const stripped = b.replace(COMMENT_RX, ' ');
      if (!PROC_RX.test(stripped))
        throw new ApiError(400, 'Each batch must start with CREATE PROCEDURE, CREATE OR ALTER PROCEDURE or ALTER PROCEDURE.');
    }
    for (const b of batches) {
      const r = await this.db.request();
      await r.batch(b);
    }
  }

  async drop(schema: string, name: string): Promise<void> {
    await this.get(schema, name);
    const r = await this.db.request();
    await r.batch(`DROP PROCEDURE ${Db.full(schema, name)}`);
  }

  /** Executes the procedure and records the run (success or failure) in the history. */
  async execute(schema: string, name: string, args: Body): Promise<ExecutionResult> {
    let database: string | null = null;
    try { database = this.db.database; } catch { /* ignore */ }
    try {
      const res = await this.executeCore(schema, name, args);
      const capped: ExecutionResult = {
        ...res,
        resultSets: res.resultSets.map((s) => (s.rows.length > HISTORY_ROWS_PER_SET ? { ...s, rows: s.rows.slice(0, HISTORY_ROWS_PER_SET) } : s)),
      };
      this.store.addExecution(schema, name, 'sqlserver', database, args ?? null, 'success', null,
        res.elapsedMs, res.rowsAffected, res.returnValue, capped);
      this.log.info('ProcedureService', `Executed ${schema}.${name} in ${res.elapsedMs} ms`);
      return res;
    } catch (e) {
      const msg = (e as Error).message;
      this.store.addExecution(schema, name, 'sqlserver', database, args ?? null, 'error', msg, 0, 0, null, null);
      this.log.warn('ProcedureService', `Execution of ${schema}.${name} failed: ${msg}`);
      throw e;
    }
  }

  private async executeCore(schema: string, name: string, args: Body): Promise<ExecutionResult> {
    const { meta } = await this.load(schema, name);
    const supplied = new Map<string, unknown>();
    if (args && typeof args === 'object' && !Array.isArray(args))
      for (const [k, v] of Object.entries(args)) supplied.set(k.replace(/^@/, '').toLowerCase(), v);
    else if (args !== undefined && args !== null) throw new ApiError(400, 'Parameters must be a JSON object.');

    const req = await this.db.request();
    const byName = new Map<string, ParamMeta>();
    for (const p of meta) {
      const key = p.name.replace(/^@/, '');
      byName.set(key, p);
      if (p.isTableType) {
        if (supplied.has(key.toLowerCase())) throw new ApiError(400, `Table-valued parameter @${key} is not supported.`);
        continue;
      }
      const type = mssqlType(p);
      const has = supplied.has(key.toLowerCase());
      const value = has ? coerce(key, supplied.get(key.toLowerCase()), p.base) : null;
      supplied.delete(key.toLowerCase());
      if (p.isOutput) req.output(key, type, value);          // OUTPUT parameters must always be sent
      else if (has) req.input(key, type, value);
    }
    if (supplied.size > 0) {
      const unknown = [...supplied.keys()].join(', ');
      throw new ApiError(400, `Unknown parameter(s): ${unknown}.`);
    }

    const started = Date.now();
    let result: sql.IProcedureResult<unknown>;
    try {
      result = await req.execute(Db.full(schema, name));
    } catch (e) {
      const err = e as { code?: string; message: string };
      if (err.code === 'EPARAM') throw new ApiError(400, 'Parameter type mismatch: ' + err.message);
      throw e;
    }
    const elapsedMs = Date.now() - started;

    const outputs: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(result.output ?? {})) {
      const p = byName.get(k);
      outputs['@' + k] = Db.normalize(v, p?.base);
    }
    const affected = (result.rowsAffected ?? []).reduce((a, b) => a + b, 0);
    const rv = result.returnValue;
    return {
      resultSets: Db.readAll(result.recordsets),
      outputParameters: outputs,
      returnValue: typeof rv === 'number' ? rv : null,
      rowsAffected: Math.max(affected, 0),
      elapsedMs,
    };
  }
}
