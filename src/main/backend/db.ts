import fs from 'node:fs';
import path from 'node:path';
import sql from 'mssql';
import {
  buildConnectionString, connInfoFromSettings, parseConnectionString,
  type ConnectionSettings, type ConnInfo,
} from './connString.ts';
import { ApiError, isoLocal, type Protector } from './errors.ts';
import type { LogSink } from './log.ts';

export type { ConnectionSettings } from './connString.ts';

export interface ConnectionStatus {
  connected: boolean;
  error: string | null;
  server: string | null;
  database: string | null;
  authType: string;
  user: string | null;
  hasPassword: boolean;
  trustServerCertificate: boolean;
  encrypt: boolean;
  connectionString: string;
}

export interface ResultSet {
  columns: string[];
  rows: Record<string, unknown>[];
  json: unknown | null;
}

interface ColumnMeta { index: number; name: string; type: { declaration?: string } }

const FILE = 'connection.local.json';

/** SQL Server error number from an mssql/tedious error, wherever the driver put it. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function sqlErrorNumber(e: any): number | undefined {
  return e?.number ?? e?.originalError?.number ?? e?.originalError?.info?.number ?? e?.precedingErrors?.[0]?.number;
}

/** Windows authentication needs a native ODBC driver (msnodesqlv8), which is optional. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function loadWindowsAuthDriver(): Promise<any> {
  const spec = 'mssql/msnodesqlv8';
  try {
    const m = await import(/* @vite-ignore */ spec);
    return m.default ?? m;
  } catch {
    throw new ApiError(
      400,
      'Windows authentication is not available in this build. Use SQL authentication (user + password) or a connection string with User ID and Password.',
    );
  }
}

export class Db {
  private current = '';
  private poolKey = '';
  private poolPromise: Promise<sql.ConnectionPool> | null = null;
  private readonly overridePath: string;
  private readonly protector: Protector;
  private readonly log: LogSink;

  constructor(dataDir: string, protector: Protector, log: LogSink) {
    this.overridePath = path.join(dataDir, FILE);
    this.protector = protector;
    this.log = log;
    try {
      if (fs.existsSync(this.overridePath)) {
        const saved = JSON.parse(fs.readFileSync(this.overridePath, 'utf8')) as { protected?: string; connectionString?: string };
        const cs = saved.protected ? this.protector.unprotect(saved.protected) : saved.connectionString;
        if (cs) { parseConnectionString(cs); this.current = cs; }
      }
    } catch (ex) {
      this.log.warn('Db', `Could not read ${FILE}: ${(ex as Error).message}`);
    }
  }

  get isConfigured(): boolean { return this.current.trim().length > 0; }
  get connectionString(): string { return this.current; }
  get database(): string | null { return this.isConfigured ? parseConnectionString(this.current).database || null : null; }

  // ---- config ---------------------------------------------------------------
  private async makeConfig(c: ConnInfo, database = c.database, connectTimeoutSec = c.connectTimeout) {
    const cfg: sql.config = {
      server: c.server,
      database: database || undefined,
      connectionTimeout: connectTimeoutSec * 1000,
      requestTimeout: c.commandTimeout * 1000,
      pool: { max: 10, min: 0, idleTimeoutMillis: 30_000 },
      options: {
        encrypt: c.encrypt,
        trustServerCertificate: c.trustServerCertificate,
        appName: c.appName ?? 'JsonProcedure',
        useUTC: true,
        enableArithAbort: true,
      },
    };
    if (c.instance) cfg.options!.instanceName = c.instance;
    else if (c.port) cfg.port = c.port;
    if (c.integrated) {
      // Only reachable with the optional native driver.
      (cfg as sql.config & { driver?: string }).driver = 'msnodesqlv8';
      (cfg.options as Record<string, unknown>).trustedConnection = true;
    } else {
      cfg.user = c.user;
      cfg.password = c.password;
    }
    return cfg;
  }

  private async newPool(c: ConnInfo, database?: string, connectTimeoutSec?: number): Promise<sql.ConnectionPool> {
    const cfg = await this.makeConfig(c, database, connectTimeoutSec);
    const driver = c.integrated ? await loadWindowsAuthDriver() : sql;
    const pool: sql.ConnectionPool = new driver.ConnectionPool(cfg);
    pool.on('error', (e: Error) => this.log.warn('Db', `Connection pool error: ${e.message}`));
    return pool;
  }

  // ---- connection use --------------------------------------------------------
  /** The shared pool for the current connection, connecting on first use. */
  async getPool(): Promise<sql.ConnectionPool> {
    if (!this.isConfigured)
      throw new ApiError(503, 'No database connection is configured yet. Open the Connection page first.');
    if (this.poolPromise && this.poolKey === this.current) {
      try {
        const existing = await this.poolPromise;
        if (existing.connected) return existing;
      } catch { /* fall through and reconnect */ }
      this.poolPromise = null;
    }
    const info = parseConnectionString(this.current);
    const key = this.current;
    const attempt = (async () => {
      const pool = await this.newPool(info);
      try {
        await pool.connect();
      } catch (e) {
        try { await pool.close(); } catch { /* ignore */ }
        const msg = (e as Error).message;
        if (e instanceof ApiError) throw e;
        if (sqlErrorNumber(e) === 4060 || /Cannot open database/i.test(msg))
          throw new ApiError(503, `Database '${info.database}' does not exist. Open the Connection page and tick 'Create database if missing'.`);
        throw new ApiError(503, 'Cannot connect to the database: ' + msg);
      }
      return pool;
    })();
    this.poolKey = key;
    this.poolPromise = attempt;
    attempt.catch(() => { if (this.poolPromise === attempt) this.poolPromise = null; });
    return attempt;
  }

  async request(tx?: sql.Transaction): Promise<sql.Request> {
    const pool = await this.getPool();
    const r = tx ? new sql.Request(tx) : pool.request();
    r.arrayRowMode = true; // result sets keep duplicate/empty column names and their order
    return r;
  }

  async transaction(): Promise<sql.Transaction> {
    const pool = await this.getPool();
    return new sql.Transaction(pool);
  }

  private async closePool(): Promise<void> {
    const p = this.poolPromise;
    this.poolPromise = null;
    if (!p) return;
    try { await (await p).close(); } catch { /* already gone */ }
  }

  async dispose(): Promise<void> { await this.closePool(); }

  // ---- connection management -----------------------------------------------------
  /** Checks the server (via master) and whether the database exists. */
  async test(c: ConnInfo): Promise<{ serverOk: boolean; dbExists: boolean; error: string | null }> {
    let pool: sql.ConnectionPool | null = null;
    try {
      pool = await this.newPool(c, 'master', Math.min(c.connectTimeout, 10));
      await pool.connect();
      if (!c.database.trim()) return { serverOk: true, dbExists: false, error: null };
      const r = await pool.request().input('n', sql.NVarChar(128), c.database).query('SELECT DB_ID(@n) AS id');
      return { serverOk: true, dbExists: r.recordset[0]?.id != null, error: null };
    } catch (e) {
      if (e instanceof ApiError) throw e;
      return { serverOk: false, dbExists: false, error: (e as Error).message };
    } finally {
      try { await pool?.close(); } catch { /* ignore */ }
    }
  }

  async createDatabase(c: ConnInfo): Promise<void> {
    if (!c.database.trim()) throw new ApiError(400, 'Database name is required.');
    const pool = await this.newPool(c, 'master');
    try {
      await pool.connect();
      await pool.request().input('n', sql.NVarChar(128), c.database).query(
        "IF DB_ID(@n) IS NULL BEGIN DECLARE @sql nvarchar(max) = 'CREATE DATABASE ' + QUOTENAME(@n); EXEC(@sql); END");
    } finally {
      try { await pool.close(); } catch { /* ignore */ }
    }
    this.log.info('Db', `Database '${c.database}' is ready.`);
  }

  /** Tests, optionally creates the database, then switches the app to this connection and saves it. */
  async apply(s: ConnectionSettings): Promise<void> {
    const info = connInfoFromSettings(s);
    const { serverOk, dbExists, error } = await this.test(info);
    if (!serverOk) throw new ApiError(400, 'Cannot connect: ' + error);
    if (!dbExists) {
      if (!s.createDatabase)
        throw new ApiError(400, "The server is reachable but the database does not exist. Tick 'Create database if missing'.");
      await this.createDatabase(info);
    }
    const cs = buildConnectionString(info);
    await this.closePool();
    this.current = cs;
    try {
      fs.mkdirSync(path.dirname(this.overridePath), { recursive: true });
      fs.writeFileSync(this.overridePath, JSON.stringify({ protected: this.protector.protect(cs) }));
    } catch (ex) {
      this.log.warn('Db', `Could not save ${FILE}: ${(ex as Error).message}`);
    }
  }

  async status(): Promise<ConnectionStatus> {
    if (!this.isConfigured) {
      return {
        connected: false, error: 'No connection configured yet.', server: null, database: null, authType: 'sql',
        user: null, hasPassword: false, trustServerCertificate: true, encrypt: false, connectionString: '',
      };
    }
    const c = parseConnectionString(this.current);
    let error: string | null = null;
    let connected = false;
    let pool: sql.ConnectionPool | null = null;
    try {
      pool = await this.newPool(c);
      await pool.connect();
      connected = true;
    } catch (e) {
      error = (e as Error).message;
    } finally {
      try { await pool?.close(); } catch { /* ignore */ }
    }
    return {
      connected, error,
      server: c.server + (c.instance ? '\\' + c.instance : '') + (c.port ? ',' + c.port : ''),
      database: c.database,
      authType: c.integrated ? 'windows' : 'sql',
      user: c.integrated ? null : c.user ?? null,
      hasPassword: !!c.password,
      trustServerCertificate: c.trustServerCertificate,
      encrypt: c.encrypt,
      connectionString: buildConnectionString(c, true),
    };
  }

  // ---- identifier helpers --------------------------------------------------------
  private static readonly newIdent = /^[\p{L}_][\p{L}\p{N}_ $#]{0,127}$/u;

  static quote(id: string): string { return '[' + id.replace(/]/g, ']]') + ']'; }

  static full(schema: string | null | undefined, name: string): string {
    return Db.quote(schema && schema.trim() ? schema : 'dbo') + '.' + Db.quote(name);
  }

  static validateIdent(id: string | null | undefined, what: string): string {
    if (!id || !id.trim() || !Db.newIdent.test(id.trim()))
      throw new ApiError(400, `Invalid ${what} '${id}'. Use letters, digits, underscores or spaces (max 128 chars, must not start with a digit).`);
    return id.trim();
  }

  // ---- result sets -------------------------------------------------------------------
  /** Turns mssql recordsets (read in array-row mode) into the JSON shape the UI expects. */
  static readAll(recordsets: unknown): ResultSet[] {
    const sets: ResultSet[] = [];
    for (const rs of (recordsets ?? []) as Array<unknown[] & { columns?: ColumnMeta[] }>) {
      const meta = rs.columns;
      if (!Array.isArray(meta) || meta.length === 0) continue; // statements without a result set

      const cols: string[] = [];
      meta.forEach((m, i) => {
        let n = m.name || `Column${i + 1}`;
        const baseName = n;
        let k = 2;
        while (cols.includes(n)) n = `${baseName}_${k++}`;
        cols.push(n);
      });

      if (meta.length === 1 && meta[0].name.startsWith('JSON_F52E2B61')) {
        // FOR JSON output: the driver hands back the joined text as a single row object.
        let text = '';
        const first = rs[0];
        if (first != null) text = String(Array.isArray(first) ? first[0] ?? '' : Object.values(first as object)[0] ?? '');
        let json: unknown | null = null;
        if (text.length > 0) { try { json = JSON.parse(text); } catch { json = null; } }
        sets.push({ columns: ['JSON'], rows: [], json });
        continue;
      }

      const rows = rs.map((raw) => {
        const arr = raw as unknown[];
        const row: Record<string, unknown> = {};
        for (let i = 0; i < cols.length; i++) row[cols[i]] = Db.normalize(arr[i], meta[i].type?.declaration);
        return row;
      });
      sets.push({ columns: cols, rows, json: null });
    }
    return sets;
  }

  /** Makes a driver value JSON-friendly, matching how the previous API serialised it. */
  static normalize(v: unknown, decl: string | undefined): unknown {
    if (v === null || v === undefined) return null;
    if (Buffer.isBuffer(v)) return v.toString('base64');
    if (v instanceof Date) {
      if (decl === 'datetimeoffset') return v.toISOString();
      if (decl === 'time') return isoLocal(v).split('T')[1] ?? isoLocal(v);
      return isoLocal(v);
    }
    if (decl === 'bigint') { const n = Number(v); return Number.isSafeInteger(n) ? n : String(v); }
    if (decl === 'uniqueidentifier') return String(v).toLowerCase();
    if (typeof v === 'object') return JSON.parse(JSON.stringify(v)); // UDTs (geography, hierarchyid, ...)
    return v;
  }

  /** JSON value -> a value mssql can bind (numbers stay numbers, everything else is a string). */
  static fromJson(v: unknown): string | number | boolean | null {
    if (v === null || v === undefined) return null;
    if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return v;
    return JSON.stringify(v); // objects and arrays are stored as their JSON text
  }
}
