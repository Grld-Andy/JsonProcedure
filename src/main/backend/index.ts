import path from 'node:path';
import sql from 'mssql';
import { connInfoFromSettings } from './connString.ts';
import { Db } from './db.ts';
import { ApiError, type Body, type Protector } from './errors.ts';
import { LogSink } from './log.ts';
import { ProcedureService } from './procedures.ts';
import { TableService } from './tables.ts';
import { UserStore } from './userStore.ts';

export interface BackendResponse { status: number; body: unknown }

interface Ctx {
  params: Record<string, string>;
  query: URLSearchParams;
  body: Body;
}
type Handler = (ctx: Ctx) => unknown | Promise<unknown>;

interface Route { method: string; segments: string[]; handler: Handler }

const NO_CONTENT = Symbol('no-content');

const opt = (v: string | null): string | null => (v === null || v === '' ? null : v);
const optInt = (v: string | null): number | null => {
  if (v === null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : null;
};
const need = (body: Body): Body => {
  if (body === null || body === undefined || typeof body !== 'object' || Array.isArray(body)) throw new ApiError(400, 'Invalid request body.');
  return body;
};
const id = (p: Record<string, string>): number => Number(p.id);

/** Turns driver/storage exceptions into the { error } messages the UI shows. */
function describeError(e: unknown): { status: number; message: string } {
  if (e instanceof ApiError) return { status: e.status, message: e.message };
  if (e instanceof sql.RequestError) {
    return { status: 400, message: e.number !== undefined ? `SQL error ${e.number}: ${e.message}` : e.message };
  }
  if (e instanceof sql.MSSQLError) return { status: 400, message: e.message };
  const any = e as { code?: string; errcode?: number; message?: string };
  if (any?.code === 'ERR_SQLITE_ERROR') return { status: 400, message: `SQLite error ${any.errcode ?? 0}: ${any.message}` };
  return { status: 500, message: (e as Error)?.message || 'Unexpected error.' };
}

export interface BackendOptions {
  /** Where userdata.db and connection.local.json live. */
  dataDir: string;
  protector: Protector;
}

/**
 * The whole application backend: the former ASP.NET API, as plain functions. `handle` takes
 * the same method + URL + JSON body the UI used to send over HTTP and returns the same status
 * and JSON body, so the UI's data layer did not have to change.
 */
export class Backend {
  readonly log = new LogSink();
  readonly store: UserStore;
  readonly db: Db;
  private readonly tables: TableService;
  private readonly procs: ProcedureService;
  private readonly routes: Route[] = [];
  private pruneTimer: ReturnType<typeof setInterval> | null = null;

  constructor(opts: BackendOptions) {
    this.store = new UserStore(opts.dataDir, opts.protector);
    this.log.attach((rows) => this.store.writeLogs(rows));
    this.db = new Db(opts.dataDir, opts.protector, this.log);
    this.tables = new TableService(this.db);
    this.procs = new ProcedureService(this.db, this.store, this.log);
    this.defineRoutes();
  }

  /** Housekeeping on startup; never throws so the app still opens when the database is unreachable. */
  async init(): Promise<void> {
    try { this.store.pruneLogs(); } catch { /* best effort */ }
    this.pruneTimer = setInterval(() => { try { this.store.pruneLogs(); } catch { /* best effort */ } }, 86_400_000);
    this.pruneTimer.unref?.();
    this.log.info('app', `JsonProcedure backend started (data: ${path.basename(path.dirname(this.store.filePath))})`);
    // Create the database if the server is reachable but the database is missing.
    try {
      if (this.db.isConfigured) {
        const { connectionString } = this.db;
        const info = connInfoFromSettings({ connectionString });
        const { serverOk, dbExists, error } = await this.db.test(info);
        if (serverOk && !dbExists && info.database) await this.db.createDatabase(info);
        else if (!serverOk) this.log.warn('app', `Database server unreachable: ${error}. Configure a connection from the UI.`);
      }
    } catch (ex) {
      this.log.warn('app', `Startup database check failed: ${(ex as Error).message}`);
    }
  }

  async dispose(): Promise<void> {
    if (this.pruneTimer) clearInterval(this.pruneTimer);
    this.log.info('app', 'JsonProcedure backend stopping');
    await this.db.dispose();
    this.log.flush();
    this.store.close();
  }

  // ------------------------------------------------------------------ dispatch
  async handle(method: string, url: string, body?: Body): Promise<BackendResponse> {
    const started = Date.now();
    const u = new URL(url, 'http://local');
    const pathName = u.pathname;
    const verb = method.toUpperCase();
    const quiet = !pathName.startsWith('/api') || pathName.startsWith('/api/logs');

    let status = 200;
    let payload: unknown;
    let errorMessage: string | undefined;
    try {
      const segs = pathName.split('/').filter(Boolean).map((s) => decodeURIComponent(s));
      const route = this.match(verb, segs);
      if (!route) throw new ApiError(404, `No such endpoint: ${verb} ${pathName}`);
      const result = await route.route.handler({ params: route.params, query: u.searchParams, body });
      if (result === NO_CONTENT) { status = 204; payload = null; } else payload = result;
    } catch (e) {
      const d = describeError(e);
      status = d.status;
      errorMessage = d.message;
      payload = { error: d.message };
      if (d.status >= 500) this.log.write('error', 'http', `${verb} ${pathName} failed: ${d.message}`, { error: d.message, stack: (e as Error)?.stack }, Date.now() - started, 500);
    }

    if (!quiet && !(status >= 500 && errorMessage)) {
      const level = status >= 500 ? 'error' : status >= 400 ? 'warning' : verb === 'GET' ? 'debug' : 'info';
      this.log.write(level, 'http', `${verb} ${pathName}${u.search} -> ${status}`,
        errorMessage ? { error: errorMessage } : undefined, Date.now() - started, status);
    }
    return { status, body: payload };
  }

  private match(method: string, segs: string[]): { route: Route; params: Record<string, string> } | null {
    for (const route of this.routes) {
      if (route.method !== method || route.segments.length !== segs.length) continue;
      const params: Record<string, string> = {};
      let ok = true;
      for (let i = 0; i < segs.length && ok; i++) {
        const want = route.segments[i];
        if (want.startsWith(':')) {
          const numeric = want.endsWith('#');
          const key = want.slice(1, numeric ? -1 : undefined);
          if (numeric && !/^-?\d+$/.test(segs[i])) ok = false; else params[key] = segs[i];
        } else if (want !== segs[i]) ok = false;
      }
      if (ok) return { route, params };
    }
    return null;
  }

  private add(method: string, pattern: string, handler: Handler): void {
    this.routes.push({ method, segments: pattern.split('/').filter(Boolean), handler });
  }

  // ------------------------------------------------------------------ endpoints
  private defineRoutes(): void {
    const { db, tables, procs, store } = this;

    // ---- connection
    this.add('GET', '/api/connection', () => db.status());
    this.add('POST', '/api/connection/test', async (c) => {
      const { serverOk, dbExists, error } = await db.test(connInfoFromSettings(need(c.body)));
      return { serverReachable: serverOk, databaseExists: dbExists, error };
    });
    this.add('PUT', '/api/connection', async (c) => { await db.apply(need(c.body)); return db.status(); });

    // ---- tables
    this.add('GET', '/api/tables', () => tables.list());
    this.add('POST', '/api/tables/preview', (c) => ({ sql: tables.buildCreateSql(need(c.body)) }));
    this.add('POST', '/api/tables', async (c) => ({ sql: await tables.create(need(c.body)) }));
    this.add('POST', '/api/tables/infer', (c) => tables.infer(need(c.body).rows));
    this.add('DELETE', '/api/tables/:schema/:name', async (c) => { await tables.drop(c.params.schema, c.params.name); return NO_CONTENT; });
    this.add('GET', '/api/tables/:schema/:name/rows', (c) => tables.rows(c.params.schema, c.params.name, optInt(c.query.get('top')) ?? 100));
    this.add('POST', '/api/tables/:schema/:name/rows', async (c) => {
      const values = need(c.body).values;
      if (values === null || typeof values !== 'object' || Array.isArray(values)) throw new ApiError(400, 'Invalid request body.');
      return { inserted: await tables.insert(c.params.schema, c.params.name, [values]) };
    });
    this.add('POST', '/api/tables/:schema/:name/import', async (c) => {
      const rows = need(c.body).rows;
      if (!Array.isArray(rows)) throw new ApiError(400, 'Invalid request body.');
      return { inserted: await tables.insert(c.params.schema, c.params.name, rows) };
    });

    // ---- procedures
    this.add('GET', '/api/procedures', () => procs.list());
    this.add('POST', '/api/procedures', async (c) => { await procs.save(need(c.body).script); return { saved: true }; });
    this.add('GET', '/api/procedures/:schema/:name', (c) => procs.get(c.params.schema, c.params.name));
    this.add('DELETE', '/api/procedures/:schema/:name', async (c) => { await procs.drop(c.params.schema, c.params.name); return NO_CONTENT; });
    this.add('POST', '/api/procedures/:schema/:name/execute', (c) =>
      procs.execute(c.params.schema, c.params.name, c.body?.parameters ?? undefined));

    // ---- settings / profile
    this.add('GET', '/api/settings', () => store.getSettings());
    this.add('PUT', '/api/settings', (c) => store.putSettings(need(c.body)));

    // ---- saved connections
    this.add('GET', '/api/connections/saved', () => store.listConnections());
    this.add('GET', '/api/connections/saved/:id#', (c) => store.getConnection(id(c.params)));
    this.add('POST', '/api/connections/saved', (c) => store.saveConnection(need(c.body)));
    this.add('POST', '/api/connections/saved/:id#/apply', async (c) => {
      await db.apply(store.getConnectionSettings(id(c.params), !!c.body?.createDatabase));
      return db.status();
    });
    this.add('DELETE', '/api/connections/saved/:id#', (c) => { store.deleteConnection(id(c.params)); return NO_CONTENT; });

    // ---- drafts
    this.add('GET', '/api/drafts', (c) =>
      c.query.get('all') === 'true' ? store.listDrafts(null, null, false) : store.listDrafts(opt(c.query.get('schema')), opt(c.query.get('name')), true));
    this.add('PUT', '/api/drafts', (c) => store.saveDraft(need(c.body)));
    this.add('DELETE', '/api/drafts', (c) => { store.deleteDraft(opt(c.query.get('schema')), opt(c.query.get('name'))); return NO_CONTENT; });

    // ---- execution history
    this.add('GET', '/api/history', (c) =>
      store.listExecutions(opt(c.query.get('schema')), opt(c.query.get('name')), optInt(c.query.get('limit')) ?? 50, optInt(c.query.get('before'))));
    this.add('GET', '/api/history/:id#', (c) => store.getExecution(id(c.params)));
    this.add('POST', '/api/history/clear', (c) => ({ cleared: store.clearExecutions(opt(c.query.get('schema')), opt(c.query.get('name'))) }));

    // ---- parameter sets
    this.add('GET', '/api/parameter-sets', (c) => store.listParameterSets(opt(c.query.get('schema')), opt(c.query.get('name'))));
    this.add('POST', '/api/parameter-sets', (c) => store.saveParameterSet(need(c.body)));
    this.add('DELETE', '/api/parameter-sets/:id#', (c) => { store.deleteParameterSet(id(c.params)); return NO_CONTENT; });

    // ---- favorites
    this.add('GET', '/api/favorites', () => store.listFavorites());
    this.add('PUT', '/api/favorites', (c) => { store.addFavorite(need(c.body)); return NO_CONTENT; });
    this.add('DELETE', '/api/favorites', (c) => {
      const kind = c.query.get('kind'), schema = c.query.get('schema'), name = c.query.get('name');
      if (kind === null || schema === null || name === null) throw new ApiError(400, 'kind, schema and name are required.');
      store.removeFavorite(kind, schema, name);
      return NO_CONTENT;
    });

    // ---- logs
    this.add('GET', '/api/logs', (c) =>
      store.queryLogs(opt(c.query.get('level')), opt(c.query.get('category')), opt(c.query.get('q')), opt(c.query.get('from')),
        opt(c.query.get('to')), optInt(c.query.get('before')), optInt(c.query.get('limit')) ?? 100));
    this.add('GET', '/api/logs/categories', () => store.logCategories());
    this.add('POST', '/api/logs/clear', () => ({ cleared: store.clearLogs() }));
  }
}
