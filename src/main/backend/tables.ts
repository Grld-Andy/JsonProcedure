import sql from 'mssql';
import { Db, type ResultSet } from './db.ts';
import { ApiError, type Body } from './errors.ts';

export interface ForeignKeyRef { schema?: string | null; table: string; column: string }

export interface ColumnDef {
  name: string;
  type: string;
  length?: string | null;
  precision?: number | null;
  scale?: number | null;
  nullable: boolean;
  primaryKey: boolean;
  identity: boolean;
  unique: boolean;
  default?: string | null;
  check?: string | null;
  references?: ForeignKeyRef | null;
}

export interface CreateTableRequest { schema?: string | null; name: string; columns: ColumnDef[] }

export interface TableColumnInfo {
  name: string; type: string; nullable: boolean; primaryKey: boolean; identity: boolean;
  unique: boolean; computed: boolean; default: string | null; references: string | null;
}

export interface TableInfo { schema: string; name: string; rowCount: number; columns: TableColumnInfo[] }

type Row = Record<string, unknown>;

const DEFAULT_RX =
  /^(NULL|-?\d+(\.\d+)?|'([^']|'')*'|(GETDATE|GETUTCDATE|SYSDATETIME|SYSUTCDATETIME|NEWID|NEWSEQUENTIALID)\(\))$/i;
const DATE_ONLY_RX = /^\d{4}-\d{2}-\d{2}$/;
const DATE_TIME_RX = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/;
const GUID_RX = /^\{?[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}\}?$/i;

const COLUMNS_SQL = `
SELECT s.name AS schema_name, t.name AS table_name, c.name AS column_name, ty.name AS type_name,
       c.max_length, c.precision, c.scale, c.is_nullable, c.is_identity, c.is_computed, dc.definition AS def,
       CASE WHEN EXISTS (SELECT 1 FROM sys.index_columns ic JOIN sys.indexes i
            ON i.object_id=ic.object_id AND i.index_id=ic.index_id
            WHERE i.is_primary_key=1 AND ic.object_id=c.object_id AND ic.column_id=c.column_id) THEN 1 ELSE 0 END AS is_pk,
       CASE WHEN EXISTS (SELECT 1 FROM sys.index_columns ic JOIN sys.indexes i
            ON i.object_id=ic.object_id AND i.index_id=ic.index_id
            WHERE i.is_unique_constraint=1 AND ic.object_id=c.object_id AND ic.column_id=c.column_id) THEN 1 ELSE 0 END AS is_unique,
       (SELECT TOP 1 rs.name+'.'+rt.name+'('+rc.name+')' FROM sys.foreign_key_columns f
            JOIN sys.tables rt ON rt.object_id=f.referenced_object_id
            JOIN sys.schemas rs ON rs.schema_id=rt.schema_id
            JOIN sys.columns rc ON rc.object_id=f.referenced_object_id AND rc.column_id=f.referenced_column_id
            WHERE f.parent_object_id=c.object_id AND f.parent_column_id=c.column_id) AS fk_ref
FROM sys.tables t
JOIN sys.schemas s ON s.schema_id=t.schema_id
JOIN sys.columns c ON c.object_id=t.object_id
JOIN sys.types ty ON ty.user_type_id=c.user_type_id
LEFT JOIN sys.default_constraints dc ON dc.object_id=c.default_object_id
WHERE t.is_ms_shipped=0
ORDER BY s.name, t.name, c.column_id`;

const COUNTS_SQL = `
SELECT s.name AS schema_name, t.name AS table_name, SUM(p.row_count) AS cnt FROM sys.dm_db_partition_stats p
JOIN sys.tables t ON t.object_id=p.object_id JOIN sys.schemas s ON s.schema_id=t.schema_id
WHERE p.index_id IN (0,1) AND t.is_ms_shipped=0 GROUP BY s.name, t.name`;

export function formatType(t: string, maxLen: number, precision: number, scale: number): string {
  switch (t) {
    case 'nvarchar': case 'nchar': return `${t}(${maxLen === -1 ? 'max' : maxLen / 2})`;
    case 'varchar': case 'char': case 'varbinary': case 'binary': return `${t}(${maxLen === -1 ? 'max' : maxLen})`;
    case 'decimal': case 'numeric': return `${t}(${precision},${scale})`;
    case 'datetime2': case 'time': case 'datetimeoffset': return `${t}(${scale})`;
    default: return t;
  }
}

export class TableService {
  private readonly db: Db;
  constructor(db: Db) { this.db = db; }

  // ---------------------------------------------------------------- listing
  async list(): Promise<TableInfo[]> {
    const colReq = await this.db.request();
    colReq.arrayRowMode = false;
    const cols = (await colReq.query(COLUMNS_SQL)).recordset as unknown as Row[];

    const map = new Map<string, TableInfo>();
    for (const r of cols) {
      const key = `${r.schema_name}.${r.table_name}`;
      let t = map.get(key);
      if (!t) map.set(key, t = { schema: r.schema_name as string, name: r.table_name as string, rowCount: 0, columns: [] });
      t.columns.push({
        name: r.column_name as string,
        type: formatType(r.type_name as string, Number(r.max_length), Number(r.precision), Number(r.scale)),
        nullable: !!r.is_nullable,
        primaryKey: Number(r.is_pk) === 1,
        identity: !!r.is_identity,
        unique: Number(r.is_unique) === 1,
        computed: !!r.is_computed,
        default: (r.def as string | null) ?? null,
        references: (r.fk_ref as string | null) ?? null,
      });
    }

    const cntReq = await this.db.request();
    cntReq.arrayRowMode = false;
    for (const r of (await cntReq.query(COUNTS_SQL)).recordset as unknown as Row[]) {
      const t = map.get(`${r.schema_name}.${r.table_name}`);
      if (t) t.rowCount = Number(r.cnt);
    }
    return [...map.values()];
  }

  private async get(schema: string, name: string): Promise<TableInfo> {
    const t = (await this.list()).find((x) =>
      x.schema.toLowerCase() === schema.toLowerCase() && x.name.toLowerCase() === name.toLowerCase());
    if (!t) throw new ApiError(404, `Table ${schema}.${name} not found.`);
    return t;
  }

  // ---------------------------------------------------------------- create
  private static buildType(c: ColumnDef): string {
    const t = (c.type ?? '').trim().toLowerCase();
    switch (t) {
      case 'int': case 'bigint': case 'smallint': case 'tinyint': case 'bit': case 'float': case 'real':
      case 'money': case 'smallmoney': case 'date': case 'datetime': case 'smalldatetime': case 'uniqueidentifier':
        return t;
      case 'nvarchar': case 'varchar': case 'varbinary': {
        const l = c.length == null || String(c.length).trim() === '' ? '255' : String(c.length).trim().toLowerCase();
        const n = /^\d+$/.test(l) ? Number(l) : NaN;
        if (l !== 'max' && !(n > 0 && n <= 8000)) throw new ApiError(400, `Invalid length '${c.length}' for column ${c.name}.`);
        if (t === 'nvarchar' && l !== 'max' && n > 4000) throw new ApiError(400, `nvarchar length for ${c.name} must be 1-4000 or max.`);
        return `${t}(${l})`;
      }
      case 'nchar': case 'char': case 'binary': {
        const cl = c.length == null || String(c.length).trim() === '' ? '10' : String(c.length).trim();
        const cn = /^\d+$/.test(cl) ? Number(cl) : NaN;
        if (!(cn > 0 && cn <= 4000)) throw new ApiError(400, `Invalid length '${c.length}' for column ${c.name}.`);
        return `${t}(${cn})`;
      }
      case 'decimal': case 'numeric': {
        const p = c.precision ?? 18;
        const s = c.scale ?? 2;
        if (!Number.isInteger(p) || !Number.isInteger(s) || p < 1 || p > 38 || s < 0 || s > p)
          throw new ApiError(400, `Invalid precision/scale for column ${c.name}.`);
        return `${t}(${p},${s})`;
      }
      case 'datetime2': case 'time': case 'datetimeoffset': {
        const sc = c.scale ?? 7;
        if (!Number.isInteger(sc) || sc < 0 || sc > 7) throw new ApiError(400, `Invalid scale for column ${c.name}.`);
        return `${t}(${sc})`;
      }
      default:
        throw new ApiError(400, `Unsupported type '${c.type}' for column ${c.name}.`);
    }
  }

  buildCreateSql(req: CreateTableRequest): string {
    const schema = req.schema && req.schema.trim() ? Db.validateIdent(req.schema, 'schema') : 'dbo';
    const table = Db.validateIdent(req.name, 'table name');
    if (!Array.isArray(req.columns) || req.columns.length === 0) throw new ApiError(400, 'A table needs at least one column.');

    const names = new Set<string>();
    const lines: string[] = [];
    const constraints: string[] = [];
    const pk: string[] = [];
    const safe = table.replace(/\W/g, '_');

    for (const c of req.columns) {
      const cname = Db.validateIdent(c.name, 'column name');
      if (names.has(cname.toLowerCase())) throw new ApiError(400, `Duplicate column '${cname}'.`);
      names.add(cname.toLowerCase());
      if (c.primaryKey) pk.push(cname);
      let line = `    ${Db.quote(cname)} ${TableService.buildType(c)}`;
      if (c.identity) {
        if (!['int', 'bigint', 'smallint', 'tinyint', 'decimal', 'numeric'].includes(c.type.toLowerCase()))
          throw new ApiError(400, `IDENTITY is not allowed on ${c.type} column '${cname}'.`);
        line += ' IDENTITY(1,1)';
      }
      line += c.nullable && !c.primaryKey && !c.identity ? ' NULL' : ' NOT NULL';
      if (c.default && c.default.trim()) {
        const d = c.default.trim();
        if (!DEFAULT_RX.test(d))
          throw new ApiError(400, `Default '${d}' for '${cname}' must be a number, 'quoted text', NULL or one of GETDATE(), GETUTCDATE(), SYSDATETIME(), SYSUTCDATETIME(), NEWID().`);
        line += ` CONSTRAINT ${Db.quote(`DF_${safe}_${cname}`)} DEFAULT ${d}`;
      }
      lines.push(line);

      if (c.unique && !c.primaryKey)
        constraints.push(`    CONSTRAINT ${Db.quote(`UQ_${safe}_${cname}`)} UNIQUE (${Db.quote(cname)})`);
      if (c.check && c.check.trim()) {
        const ck = c.check.trim();
        if (ck.includes(';') || ck.includes('--') || ck.includes('/*'))
          throw new ApiError(400, `CHECK expression for '${cname}' contains forbidden characters.`);
        constraints.push(`    CONSTRAINT ${Db.quote(`CK_${safe}_${cname}`)} CHECK (${ck})`);
      }
      const fk = c.references;
      if (fk && fk.table && fk.table.trim() && fk.column && fk.column.trim()) {
        const rs = fk.schema && fk.schema.trim() ? fk.schema : 'dbo';
        constraints.push(`    CONSTRAINT ${Db.quote(`FK_${safe}_${cname}`)} FOREIGN KEY (${Db.quote(cname)}) REFERENCES ${Db.full(rs, fk.table)} (${Db.quote(fk.column)})`);
      }
    }
    if (pk.length > 0)
      constraints.unshift(`    CONSTRAINT ${Db.quote(`PK_${safe}`)} PRIMARY KEY (${pk.map(Db.quote).join(', ')})`);

    return `CREATE TABLE ${Db.full(schema, table)} (\n${[...lines, ...constraints].join(',\n')}\n);`;
  }

  async create(req: CreateTableRequest): Promise<string> {
    const text = this.buildCreateSql(req);
    const r = await this.db.request();
    await r.batch(text);
    return text;
  }

  async drop(schema: string, name: string): Promise<void> {
    await this.get(schema, name);
    const r = await this.db.request();
    await r.batch(`DROP TABLE ${Db.full(schema, name)}`);
  }

  // ---------------------------------------------------------------- rows
  async rows(schema: string, name: string, top: number): Promise<ResultSet> {
    await this.get(schema, name);
    const n = Math.min(Math.max(Math.trunc(Number(top)) || 100, 1), 10000);
    const r = await this.db.request();
    const res = await r.query(`SELECT TOP (${n}) * FROM ${Db.full(schema, name)}`);
    return Db.readAll(res.recordsets)[0] ?? { columns: [], rows: [], json: null };
  }

  async insert(schema: string, name: string, rows: Record<string, unknown>[]): Promise<number> {
    if (!Array.isArray(rows) || rows.length === 0) throw new ApiError(400, 'No rows supplied.');
    const table = await this.get(schema, name);
    const writable = new Map(table.columns.filter((c) => !c.identity && !c.computed).map((c) => [c.name.toLowerCase(), c]));
    const skipped = new Set(table.columns.filter((c) => c.identity || c.computed).map((c) => c.name.toLowerCase()));

    const tx = await this.db.transaction();
    await tx.begin();
    let i = 0;
    try {
      for (const row of rows) {
        i++;
        if (row === null || typeof row !== 'object' || Array.isArray(row))
          throw new ApiError(400, `Row ${i}: expected a JSON object.`);
        const keys = Object.keys(row);
        const unknown = keys.filter((k) => !writable.has(k.toLowerCase()) && !skipped.has(k.toLowerCase()));
        if (unknown.length > 0) throw new ApiError(400, `Row ${i}: unknown column(s) ${unknown.join(', ')}.`);
        const used = keys.filter((k) => writable.has(k.toLowerCase()));

        const req = await this.db.request(tx);
        let text: string;
        if (used.length === 0) text = `INSERT INTO ${Db.full(schema, name)} DEFAULT VALUES`;
        else {
          used.forEach((k, n) => req.input('p' + n, Db.fromJson(row[k])));
          text = `INSERT INTO ${Db.full(schema, name)} (${used.map((k) => Db.quote(writable.get(k.toLowerCase())!.name)).join(', ')}) ` +
                 `VALUES (${used.map((_, n) => '@p' + n).join(', ')})`;
        }
        await req.query(text);
      }
      await tx.commit();
    } catch (e) {
      try { await tx.rollback(); } catch { /* already rolled back by the server */ }
      if (e instanceof ApiError) throw e;
      if (e instanceof sql.MSSQLError) throw new ApiError(400, `Row ${i} failed (nothing was saved): ${e.message}`);
      throw e;
    }
    return rows.length;
  }

  // ---------------------------------------------------------------- inference
  infer(rows: Body): ColumnDef[] {
    if (!Array.isArray(rows) || rows.length === 0) throw new ApiError(400, 'The JSON contains no rows.');
    const keys: string[] = [];
    for (const r of rows) for (const k of Object.keys(r ?? {})) if (!keys.includes(k)) keys.push(k);

    const result: ColumnDef[] = [];
    for (const k of keys) {
      const missing = rows.some((r: Row) => !Object.prototype.hasOwnProperty.call(r, k));
      const nn = rows.filter((r: Row) => r[k] !== null && r[k] !== undefined).map((r: Row) => r[k]);
      const nullable = missing || nn.length < rows.length;
      let type = 'nvarchar';
      let len: string | null = 'max';
      let isPk = false;

      if (nn.length === 0) len = '255';
      else if (nn.every((v: unknown) => typeof v === 'boolean')) { type = 'bit'; len = null; }
      else if (nn.every((v: unknown) => typeof v === 'number')) {
        len = null;
        if (nn.every((v: number) => Number.isSafeInteger(v))) {
          type = nn.every((v: number) => v >= -2147483648 && v <= 2147483647) ? 'int' : 'bigint';
          isPk = !nullable && k.toLowerCase() === 'id' && new Set(nn).size === nn.length;
        } else type = 'float';
      } else if (nn.every((v: unknown) => typeof v === 'string')) {
        const strs = nn as string[];
        if (strs.every((s) => GUID_RX.test(s))) { type = 'uniqueidentifier'; len = null; }
        else if (strs.every((s) => DATE_ONLY_RX.test(s))) { type = 'date'; len = null; }
        else if (strs.every((s) => DATE_TIME_RX.test(s) && !Number.isNaN(Date.parse(s)))) { type = 'datetime2'; len = null; }
        else {
          const max = strs.reduce((m, s) => Math.max(m, s.length), 0);
          len = max > 2000 ? 'max' : String(Math.max(50, max * 2));
        }
      }
      result.push({
        name: k, type, length: len, precision: null, scale: null, nullable, primaryKey: isPk,
        identity: false, unique: false, default: null, check: null, references: null,
      });
    }
    return result;
  }
}
