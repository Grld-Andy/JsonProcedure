import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import type { ConnectionSettings } from './connString.ts';
import { ApiError, nowIso, type Body, type Protector } from './errors.ts';
import { levelNo, type LogRow } from './log.ts';

export interface SavedConnection {
  id: number; name: string; dbType: string; server: string | null; port: number | null; database: string | null;
  authType: string | null; user: string | null; hasPassword: boolean; usesConnectionString: boolean;
  trustServerCertificate: boolean; encrypt: boolean; createdAt: string; updatedAt: string;
}
export interface Draft { id: number; schema: string | null; name: string | null; script: string; updatedAt: string }
export interface ExecutionRecordSummary {
  id: number; schema: string; name: string; dbType: string; database: string | null; status: string;
  error: string | null; elapsedMs: number; rowsAffected: number; returnValue: number | null; createdAt: string;
}
export interface ExecutionRecord extends ExecutionRecordSummary { parameters: unknown | null; result: unknown | null }
export interface ParameterSet { id: number; schema: string; name: string; label: string; parameters: unknown; createdAt: string }
export interface Favorite { kind: string; schema: string; name: string; createdAt: string }
export interface LogEntry {
  id: number; ts: string; level: string; category: string; message: string;
  details: unknown | null; durationMs: number | null; statusCode: number | null;
}
export interface LogPage { items: LogEntry[]; nextBefore: number | null }

type Row = Record<string, unknown>;
type Params = Record<string, unknown>;

const HISTORY_KEEP = 2000;
const CONN_COLS =
  'id,name,db_type,server,port,database,auth_type,user,password_enc,connection_string_enc,trust_cert,encrypt,created_at,updated_at';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS settings(
    key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS saved_connections(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE COLLATE NOCASE,
    db_type TEXT NOT NULL DEFAULT 'sqlserver',
    server TEXT, port INTEGER, database TEXT, auth_type TEXT, user TEXT,
    password_enc TEXT, connection_string_enc TEXT,
    trust_cert INTEGER NOT NULL DEFAULT 1, encrypt INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS drafts(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    schema_name TEXT NOT NULL DEFAULT '', proc_name TEXT NOT NULL DEFAULT '',
    script TEXT NOT NULL, updated_at TEXT NOT NULL,
    UNIQUE(schema_name, proc_name));

CREATE TABLE IF NOT EXISTS executions(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    schema_name TEXT NOT NULL, proc_name TEXT NOT NULL,
    db_type TEXT NOT NULL, database TEXT,
    parameters_json TEXT, status TEXT NOT NULL, error TEXT,
    elapsed_ms INTEGER NOT NULL DEFAULT 0, rows_affected INTEGER NOT NULL DEFAULT 0,
    return_value INTEGER, result_json TEXT, created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS ix_exec_proc ON executions(schema_name, proc_name, id DESC);

CREATE TABLE IF NOT EXISTS parameter_sets(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    schema_name TEXT NOT NULL, proc_name TEXT NOT NULL,
    label TEXT NOT NULL, parameters_json TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS ix_pset_proc ON parameter_sets(schema_name, proc_name);

CREATE TABLE IF NOT EXISTS favorites(
    kind TEXT NOT NULL, schema_name TEXT NOT NULL, name TEXT NOT NULL, created_at TEXT NOT NULL,
    PRIMARY KEY(kind, schema_name, name));

CREATE TABLE IF NOT EXISTS logs(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ts TEXT NOT NULL, level TEXT NOT NULL, level_no INTEGER NOT NULL,
    category TEXT NOT NULL, message TEXT NOT NULL, details_json TEXT,
    duration_ms INTEGER, status_code INTEGER);
CREATE INDEX IF NOT EXISTS ix_logs_ts ON logs(id DESC);
`;

function parseJson(raw: unknown): unknown | null {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

const str = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));
const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

/**
 * SQLite-backed storage for everything the app remembers about "the user":
 * settings/profile, saved connections, procedure drafts, execution history,
 * saved parameter sets, favorites and the activity log. There is a single local user.
 */
export class UserStore {
  readonly filePath: string;
  private readonly db: DatabaseSync;
  private readonly protector: Protector;

  constructor(dataDir: string, protector: Protector) {
    fs.mkdirSync(dataDir, { recursive: true });
    this.filePath = path.join(dataDir, 'userdata.db');
    this.protector = protector;
    this.db = new DatabaseSync(this.filePath);
    this.db.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;');
    this.db.exec(SCHEMA);
  }

  close(): void { try { this.db.close(); } catch { /* already closed */ } }

  // ------------------------------------------------------------------ plumbing
  private clean(p: Params): Record<string, SQLInputValue> {
    const out: Record<string, SQLInputValue> = {};
    for (const [k, v] of Object.entries(p)) out['$' + k] = (v === undefined ? null : v) as SQLInputValue;
    return out;
  }
  private run(sqlText: string, p: Params = {}) { return this.db.prepare(sqlText).run(this.clean(p)); }
  private all(sqlText: string, p: Params = {}): Row[] { return this.db.prepare(sqlText).all(this.clean(p)) as Row[]; }
  private one(sqlText: string, p: Params = {}): Row | undefined { return this.db.prepare(sqlText).get(this.clean(p)) as Row | undefined; }
  private tx<T>(fn: () => T): T {
    this.db.exec('BEGIN');
    try { const r = fn(); this.db.exec('COMMIT'); return r; }
    catch (e) { try { this.db.exec('ROLLBACK'); } catch { /* ignore */ } throw e; }
  }

  // ------------------------------------------------------------------ settings
  getSettings(): Record<string, unknown> {
    const d: Record<string, unknown> = {};
    for (const r of this.all('SELECT key, value FROM settings')) {
      const v = parseJson(r.value);
      if (v !== null) d[r.key as string] = v;
    }
    return d;
  }

  /** Merges the given keys into the stored settings. A JSON null removes the key. */
  putSettings(values: Body): Record<string, unknown> {
    if (!values || typeof values !== 'object' || Array.isArray(values)) throw new ApiError(400, 'Settings must be a JSON object.');
    const entries = Object.entries(values);
    if (entries.length > 100) throw new ApiError(400, 'Too many settings keys.');
    this.tx(() => {
      for (const [k, v] of entries) {
        if (!k.trim() || k.length > 100) throw new ApiError(400, 'Invalid settings key.');
        if (v === null || v === undefined) { this.run('DELETE FROM settings WHERE key=$k', { k }); continue; }
        const raw = JSON.stringify(v);
        if (raw.length > 200_000) throw new ApiError(400, `Setting '${k}' is too large.`);
        this.run(
          'INSERT INTO settings(key,value,updated_at) VALUES($k,$v,$t) ON CONFLICT(key) DO UPDATE SET value=$v, updated_at=$t',
          { k, v: raw, t: nowIso() });
      }
    });
    return this.getSettings();
  }

  // ------------------------------------------------------------------ saved connections
  private static readConn(r: Row): SavedConnection {
    return {
      id: Number(r.id), name: r.name as string, dbType: r.db_type as string, server: str(r.server), port: num(r.port),
      database: str(r.database), authType: str(r.auth_type), user: str(r.user),
      hasPassword: r.password_enc != null, usesConnectionString: r.connection_string_enc != null,
      trustServerCertificate: Number(r.trust_cert) === 1, encrypt: Number(r.encrypt) === 1,
      createdAt: r.created_at as string, updatedAt: r.updated_at as string,
    };
  }

  listConnections(): SavedConnection[] {
    return this.all(`SELECT ${CONN_COLS} FROM saved_connections ORDER BY name`).map(UserStore.readConn);
  }

  getConnection(id: number): SavedConnection {
    const r = this.one(`SELECT ${CONN_COLS} FROM saved_connections WHERE id=$id`, { id });
    if (!r) throw new ApiError(404, 'Saved connection not found.');
    return UserStore.readConn(r);
  }

  /** Password / connectionString left empty on an update keep the stored value. */
  saveConnection(q: Body): SavedConnection {
    const name = typeof q?.name === 'string' ? q.name.trim() : '';
    if (!name || name.length > 100) throw new ApiError(400, 'A connection name (max 100 chars) is required.');
    const type = q.dbType && String(q.dbType).trim() ? String(q.dbType).trim().toLowerCase() : 'sqlserver';
    const hasCs = !!(q.connectionString && String(q.connectionString).trim());
    const password = q.password ? this.protector.protect(String(q.password)) : null;
    const cs = hasCs ? this.protector.protect(String(q.connectionString)) : null;
    const tc = (q.trustServerCertificate ?? true) ? 1 : 0;
    const enc = (q.encrypt ?? false) ? 1 : 0;
    const server = hasCs ? null : (q.server ? String(q.server).trim() : null);
    const port = hasCs ? null : (q.port ?? null);
    const database = hasCs ? null : (q.database ? String(q.database).trim() : null);
    const now = nowIso();

    const existing = this.one('SELECT id FROM saved_connections WHERE name=$n', { n: name });
    if (!existing) {
      const res = this.run(
        'INSERT INTO saved_connections(name,db_type,server,port,database,auth_type,user,password_enc,connection_string_enc,trust_cert,encrypt,created_at,updated_at) ' +
        'VALUES($n,$t,$s,$p,$d,$a,$u,$pw,$cs,$tc,$e,$now,$now)',
        { n: name, t: type, s: server, p: port, d: database, a: q.authType ?? null, u: q.user ?? null, pw: password, cs, tc, e: enc, now });
      return this.getConnection(Number(res.lastInsertRowid));
    }

    // Update: secrets that are not supplied keep their stored value.
    const windows = String(q.authType ?? '').toLowerCase() === 'windows';
    this.run(
      'UPDATE saved_connections SET db_type=$t, server=$s, port=$p, database=$d, auth_type=$a, user=$u, ' +
      'password_enc=COALESCE($pw, CASE WHEN $clearpw=1 THEN NULL ELSE password_enc END), ' +
      'connection_string_enc=CASE WHEN $form=1 THEN NULL ELSE COALESCE($cs, connection_string_enc) END, ' +
      'trust_cert=$tc, encrypt=$e, updated_at=$now WHERE id=$id',
      {
        id: existing.id, t: type, s: server, p: port, d: database, a: q.authType ?? null, u: q.user ?? null,
        pw: password, clearpw: windows ? 1 : 0, cs, form: !hasCs && q.server && String(q.server).trim() ? 1 : 0, tc, e: enc, now,
      });
    return this.getConnection(Number(existing.id));
  }

  /** Returns the stored connection with secrets decrypted, for applying it. Never expose the result. */
  getConnectionSettings(id: number, createDatabase: boolean): ConnectionSettings {
    const r = this.one(`SELECT ${CONN_COLS} FROM saved_connections WHERE id=$id`, { id });
    if (!r) throw new ApiError(404, 'Saved connection not found.');
    let pw: string | null = null;
    let cs: string | null = null;
    try {
      if (r.password_enc != null) pw = this.protector.unprotect(r.password_enc as string);
      if (r.connection_string_enc != null) cs = this.protector.unprotect(r.connection_string_enc as string);
    } catch {
      throw new ApiError(409, 'The stored credentials can no longer be decrypted (they were saved by a different user or machine, or by an older version of the app). Re-enter and save the connection again.');
    }
    return {
      connectionString: cs, server: str(r.server), port: num(r.port), database: str(r.database),
      authType: str(r.auth_type), user: str(r.user), password: pw,
      trustServerCertificate: Number(r.trust_cert) === 1, encrypt: Number(r.encrypt) === 1,
      createDatabase, dbType: r.db_type as string,
    };
  }

  deleteConnection(id: number): void {
    if (this.run('DELETE FROM saved_connections WHERE id=$id', { id }).changes === 0)
      throw new ApiError(404, 'Saved connection not found.');
  }

  // ------------------------------------------------------------------ drafts
  listDrafts(schema: string | null, name: string | null, exact: boolean): Draft[] {
    const rows = exact
      ? this.all('SELECT id,schema_name,proc_name,script,updated_at FROM drafts WHERE schema_name=$s AND proc_name=$n',
          { s: schema ?? '', n: name ?? '' })
      : this.all('SELECT id,schema_name,proc_name,script,updated_at FROM drafts ORDER BY updated_at DESC');
    return rows.map((r) => ({
      id: Number(r.id), schema: (r.schema_name as string) || null, name: (r.proc_name as string) || null,
      script: r.script as string, updatedAt: r.updated_at as string,
    }));
  }

  saveDraft(q: Body): Draft {
    if (typeof q?.script !== 'string') throw new ApiError(400, 'Script is required.');
    if (q.script.length > 2_000_000) throw new ApiError(400, 'Script is too large.');
    const s = q.schema ?? '';
    const n = q.name ?? '';
    const t = nowIso();
    this.run(
      'INSERT INTO drafts(schema_name,proc_name,script,updated_at) VALUES($s,$n,$sc,$t) ' +
      'ON CONFLICT(schema_name,proc_name) DO UPDATE SET script=$sc, updated_at=$t',
      { s, n, sc: q.script, t });
    const id = Number(this.one('SELECT id FROM drafts WHERE schema_name=$s AND proc_name=$n', { s, n })!.id);
    return { id, schema: q.schema ?? null, name: q.name ?? null, script: q.script, updatedAt: t };
  }

  deleteDraft(schema: string | null, name: string | null): void {
    this.run('DELETE FROM drafts WHERE schema_name=$s AND proc_name=$n', { s: schema ?? '', n: name ?? '' });
  }

  // ------------------------------------------------------------------ execution history
  addExecution(
    schema: string, name: string, dbType: string, database: string | null, parameters: unknown,
    status: string, error: string | null, elapsedMs: number, rowsAffected: number, returnValue: number | null, result: unknown,
  ): void {
    try {
      this.run(
        'INSERT INTO executions(schema_name,proc_name,db_type,database,parameters_json,status,error,elapsed_ms,rows_affected,return_value,result_json,created_at) ' +
        'VALUES($s,$n,$t,$d,$p,$st,$e,$ms,$ra,$rv,$res,$now)',
        {
          s: schema, n: name, t: dbType, d: database,
          p: parameters === null || parameters === undefined ? null : JSON.stringify(parameters),
          st: status, e: error, ms: elapsedMs, ra: rowsAffected, rv: returnValue,
          res: result === null || result === undefined ? null : JSON.stringify(result), now: nowIso(),
        });
      this.run('DELETE FROM executions WHERE id <= (SELECT MAX(id) FROM executions) - $keep', { keep: HISTORY_KEEP });
    } catch { /* history is best effort and must never break an execution */ }
  }

  private static execSummary(r: Row): ExecutionRecordSummary {
    return {
      id: Number(r.id), schema: r.schema_name as string, name: r.proc_name as string, dbType: r.db_type as string,
      database: str(r.database), status: r.status as string, error: str(r.error), elapsedMs: Number(r.elapsed_ms),
      rowsAffected: Number(r.rows_affected), returnValue: num(r.return_value), createdAt: r.created_at as string,
    };
  }

  listExecutions(schema: string | null, name: string | null, limit: number, before: number | null): ExecutionRecordSummary[] {
    const l = Math.min(Math.max(limit || 50, 1), 500);
    return this.all(
      'SELECT id,schema_name,proc_name,db_type,database,status,error,elapsed_ms,rows_affected,return_value,created_at FROM executions ' +
      'WHERE ($s IS NULL OR schema_name=$s) AND ($n IS NULL OR proc_name=$n) AND ($b IS NULL OR id<$b) ORDER BY id DESC LIMIT $l',
      { s: schema, n: name, b: before, l }).map(UserStore.execSummary);
  }

  getExecution(id: number): ExecutionRecord {
    const r = this.one(
      'SELECT id,schema_name,proc_name,db_type,database,status,error,elapsed_ms,rows_affected,return_value,created_at,parameters_json,result_json ' +
      'FROM executions WHERE id=$id', { id });
    if (!r) throw new ApiError(404, 'History entry not found.');
    return { ...UserStore.execSummary(r), parameters: parseJson(r.parameters_json), result: parseJson(r.result_json) };
  }

  clearExecutions(schema: string | null, name: string | null): number {
    return Number(this.run(
      'DELETE FROM executions WHERE ($s IS NULL OR schema_name=$s) AND ($n IS NULL OR proc_name=$n)', { s: schema, n: name }).changes);
  }

  // ------------------------------------------------------------------ parameter sets
  listParameterSets(schema: string | null, name: string | null): ParameterSet[] {
    return this.all(
      'SELECT id,schema_name,proc_name,label,parameters_json,created_at FROM parameter_sets ' +
      'WHERE ($s IS NULL OR schema_name=$s) AND ($n IS NULL OR proc_name=$n) ORDER BY label', { s: schema, n: name })
      .map((r) => ({
        id: Number(r.id), schema: r.schema_name as string, name: r.proc_name as string, label: r.label as string,
        parameters: parseJson(r.parameters_json) ?? {}, createdAt: r.created_at as string,
      }));
  }

  saveParameterSet(q: Body): ParameterSet {
    const label = typeof q?.label === 'string' ? q.label.trim() : '';
    if (!label || label.length > 100) throw new ApiError(400, 'A label (max 100 chars) is required.');
    if (!q.schema || !String(q.schema).trim() || !q.name || !String(q.name).trim()) throw new ApiError(400, 'Schema and name are required.');
    if (q.parameters === null || typeof q.parameters !== 'object' || Array.isArray(q.parameters))
      throw new ApiError(400, 'Parameters must be a JSON object.');
    const t = nowIso();
    const res = this.run(
      'INSERT INTO parameter_sets(schema_name,proc_name,label,parameters_json,created_at) VALUES($s,$n,$l,$p,$t)',
      { s: q.schema, n: q.name, l: label, p: JSON.stringify(q.parameters), t });
    return { id: Number(res.lastInsertRowid), schema: q.schema, name: q.name, label, parameters: q.parameters, createdAt: t };
  }

  deleteParameterSet(id: number): void {
    if (this.run('DELETE FROM parameter_sets WHERE id=$id', { id }).changes === 0) throw new ApiError(404, 'Parameter set not found.');
  }

  // ------------------------------------------------------------------ favorites
  private static kind(k: unknown): string {
    const v = typeof k === 'string' ? k.toLowerCase() : '';
    if (v === 'procedure' || v === 'table') return v;
    throw new ApiError(400, "kind must be 'procedure' or 'table'.");
  }

  listFavorites(): Favorite[] {
    return this.all('SELECT kind,schema_name,name,created_at FROM favorites ORDER BY kind, schema_name, name')
      .map((r) => ({ kind: r.kind as string, schema: r.schema_name as string, name: r.name as string, createdAt: r.created_at as string }));
  }

  addFavorite(q: Body): void {
    if (!q?.schema || !String(q.schema).trim() || !q?.name || !String(q.name).trim()) throw new ApiError(400, 'Schema and name are required.');
    this.run('INSERT OR IGNORE INTO favorites(kind,schema_name,name,created_at) VALUES($k,$s,$n,$t)',
      { k: UserStore.kind(q.kind), s: q.schema, n: q.name, t: nowIso() });
  }

  removeFavorite(kind: string, schema: string, name: string): void {
    this.run('DELETE FROM favorites WHERE kind=$k AND schema_name=$s AND name=$n', { k: UserStore.kind(kind), s: schema, n: name });
  }

  // ------------------------------------------------------------------ logs
  writeLogs(rows: LogRow[]): void {
    if (rows.length === 0) return;
    this.tx(() => {
      const stmt = this.db.prepare(
        'INSERT INTO logs(ts,level,level_no,category,message,details_json,duration_ms,status_code) VALUES($ts,$lv,$ln,$c,$m,$d,$ms,$sc)');
      for (const l of rows)
        stmt.run(this.clean({ ts: l.ts, lv: l.level, ln: l.levelNo, c: l.category, m: l.message, d: l.detailsJson, ms: l.durationMs, sc: l.statusCode }));
    });
  }

  queryLogs(
    minLevel: string | null, category: string | null, q: string | null, from: string | null, to: string | null,
    before: number | null, limit: number,
  ): LogPage {
    const l = Math.min(Math.max(limit || 100, 1), 500);
    const like = q && q.trim() ? q.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_') : null;
    const rows = this.all(
      'SELECT id,ts,level,category,message,details_json,duration_ms,status_code FROM logs ' +
      "WHERE level_no>=$min AND ($cat IS NULL OR category=$cat) AND ($q IS NULL OR message LIKE '%'||$q||'%' ESCAPE '\\' OR details_json LIKE '%'||$q||'%' ESCAPE '\\') " +
      'AND ($from IS NULL OR ts>=$from) AND ($to IS NULL OR ts<=$to) AND ($b IS NULL OR id<$b) ORDER BY id DESC LIMIT $l',
      {
        min: levelNo(minLevel), cat: category && category.trim() ? category : null, q: like,
        from: from && from.trim() ? from : null, to: to && to.trim() ? to : null, b: before, l: l + 1,
      });
    const items: LogEntry[] = rows.map((r) => ({
      id: Number(r.id), ts: r.ts as string, level: r.level as string, category: r.category as string,
      message: r.message as string, details: parseJson(r.details_json), durationMs: num(r.duration_ms), statusCode: num(r.status_code),
    }));
    let nextBefore: number | null = null;
    if (items.length > l) { items.pop(); nextBefore = items[items.length - 1].id; }
    return { items, nextBefore };
  }

  logCategories(): string[] {
    return this.all('SELECT DISTINCT category FROM logs ORDER BY category').map((r) => r.category as string);
  }

  clearLogs(): number { return Number(this.run('DELETE FROM logs').changes); }

  /** Keeps the newest 10,000 log rows and nothing older than 30 days. */
  pruneLogs(): void {
    this.run('DELETE FROM logs WHERE ts < $cut OR id <= (SELECT COALESCE(MAX(id),0) FROM logs) - 10000',
      { cut: new Date(Date.now() - 30 * 86_400_000).toISOString() });
  }
}
