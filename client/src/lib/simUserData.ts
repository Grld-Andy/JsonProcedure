/**
 * Simulation-mode stand-in for the backend's SQLite user store (drafts, history, parameter sets,
 * favorites, saved connections and logs). Everything is kept in localStorage so the UI behaves the
 * same with and without the real backend. It has no imports from api.ts to avoid a cycle.
 */

export type DbEngineId = 'sqlserver' | 'postgres' | 'mysql' | 'sqlite' | 'mariadb' | 'oracle';

export interface SavedConnection {
  id: number;
  name: string;
  dbType: string;
  server: string | null;
  port: number | null;
  database: string | null;
  authType: string | null;
  user: string | null;
  hasPassword: boolean;
  usesConnectionString: boolean;
  trustServerCertificate: boolean;
  encrypt: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Draft {
  id: number;
  schema: string | null;
  name: string | null;
  script: string;
  updatedAt: string;
}

export interface ExecutionRecordSummary {
  id: number;
  schema: string;
  name: string;
  dbType: string;
  database: string | null;
  status: 'success' | 'error';
  error: string | null;
  elapsedMs: number;
  rowsAffected: number;
  returnValue: number | null;
  createdAt: string;
}

export interface ExecutionRecord extends ExecutionRecordSummary {
  parameters: Record<string, unknown> | null;
  result: unknown | null;
}

export interface ParameterSet {
  id: number;
  schema: string;
  name: string;
  label: string;
  parameters: Record<string, unknown>;
  createdAt: string;
}

export interface Favorite {
  kind: 'procedure' | 'table';
  schema: string;
  name: string;
  createdAt: string;
}

export type LogLevel = 'debug' | 'info' | 'warning' | 'error' | 'critical';

export interface LogEntry {
  id: number;
  ts: string;
  level: LogLevel;
  category: string;
  message: string;
  details: unknown | null;
  durationMs: number | null;
  statusCode: number | null;
}

export interface LogPage {
  items: LogEntry[];
  nextBefore: number | null;
}

interface SimData {
  seq: number;
  connections: (SavedConnection & { secret?: Record<string, unknown> })[];
  drafts: Draft[];
  history: ExecutionRecord[];
  paramSets: ParameterSet[];
  favorites: Favorite[];
  logs: LogEntry[];
}

const KEY = 'jp_sim_userdata';
const MAX_HISTORY = 200;
const MAX_LOGS = 1000;

function empty(): SimData {
  return { seq: 1, connections: [], drafts: [], history: [], paramSets: [], favorites: [], logs: [] };
}

let cache: SimData | null = null;

function load(): SimData {
  if (cache) return cache;
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      cache = { ...empty(), ...(JSON.parse(raw) as Partial<SimData>) };
      return cache;
    }
  } catch {
    /* ignore storage errors */
  }
  cache = empty();
  return cache;
}

function save(): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(cache));
  } catch {
    /* ignore storage errors (quota, private mode) */
  }
}

const now = () => new Date().toISOString();
const nextId = (d: SimData) => d.seq++;

export const simUserData = {
  // ---- logs
  log(level: LogLevel, category: string, message: string, details: unknown = null, durationMs: number | null = null) {
    const d = load();
    d.logs.push({ id: nextId(d), ts: now(), level, category, message, details, durationMs, statusCode: null });
    if (d.logs.length > MAX_LOGS) d.logs.splice(0, d.logs.length - MAX_LOGS);
    save();
  },

  logs(q: { level?: string; category?: string; q?: string; before?: number; limit?: number }): LogPage {
    const rank: Record<string, number> = { debug: 1, info: 2, warning: 3, error: 4, critical: 5 };
    const min = rank[q.level ?? 'debug'] ?? 1;
    const limit = q.limit ?? 100;
    const needle = q.q?.toLowerCase();
    const all = load()
      .logs.filter(
        (l) =>
          (rank[l.level] ?? 2) >= min &&
          (!q.category || l.category === q.category) &&
          (!needle || l.message.toLowerCase().includes(needle)) &&
          (q.before === undefined || l.id < q.before)
      )
      .sort((a, b) => b.id - a.id);
    const items = all.slice(0, limit);
    return { items, nextBefore: all.length > limit ? items[items.length - 1].id : null };
  },

  logCategories(): string[] {
    return [...new Set(load().logs.map((l) => l.category))].sort();
  },

  clearLogs(): { cleared: number } {
    const d = load();
    const cleared = d.logs.length;
    d.logs = [];
    save();
    return { cleared };
  },

  // ---- history
  addExecution(
    schema: string,
    name: string,
    parameters: Record<string, unknown> | null,
    outcome: { error?: string; elapsedMs?: number; rowsAffected?: number; returnValue?: number | null; result?: unknown }
  ) {
    const d = load();
    d.history.push({
      id: nextId(d),
      schema,
      name,
      dbType: 'sqlserver',
      database: null,
      status: outcome.error ? 'error' : 'success',
      error: outcome.error ?? null,
      elapsedMs: outcome.elapsedMs ?? 0,
      rowsAffected: outcome.rowsAffected ?? 0,
      returnValue: outcome.returnValue ?? null,
      createdAt: now(),
      parameters,
      result: outcome.result ?? null,
    });
    if (d.history.length > MAX_HISTORY) d.history.splice(0, d.history.length - MAX_HISTORY);
    save();
    simUserData.log(
      outcome.error ? 'warning' : 'info',
      'ProcedureService',
      outcome.error
        ? `Execution of ${schema}.${name} failed: ${outcome.error}`
        : `Executed ${schema}.${name} in ${outcome.elapsedMs ?? 0} ms`
    );
  },

  history(q: { schema?: string; name?: string; limit?: number; before?: number }): ExecutionRecordSummary[] {
    return load()
      .history.filter(
        (h) =>
          (!q.schema || h.schema === q.schema) &&
          (!q.name || h.name === q.name) &&
          (q.before === undefined || h.id < q.before)
      )
      .sort((a, b) => b.id - a.id)
      .slice(0, q.limit ?? 50)
      .map(({ parameters: _p, result: _r, ...summary }) => summary);
  },

  execution(id: number): ExecutionRecord {
    const h = load().history.find((x) => x.id === id);
    if (!h) throw new Error('History entry not found.');
    return h;
  },

  clearHistory(q: { schema?: string; name?: string }): { cleared: number } {
    const d = load();
    const before = d.history.length;
    d.history = d.history.filter((h) => (q.schema && h.schema !== q.schema) || (q.name && h.name !== q.name));
    save();
    return { cleared: before - d.history.length };
  },

  // ---- drafts
  draft(schema: string | null, name: string | null): Draft[] {
    return load().drafts.filter((x) => (x.schema ?? null) === (schema ?? null) && (x.name ?? null) === (name ?? null));
  },

  saveDraft(schema: string | null, name: string | null, script: string): Draft {
    const d = load();
    let existing = d.drafts.find((x) => (x.schema ?? null) === (schema ?? null) && (x.name ?? null) === (name ?? null));
    if (existing) {
      existing.script = script;
      existing.updatedAt = now();
    } else {
      existing = { id: nextId(d), schema, name, script, updatedAt: now() };
      d.drafts.push(existing);
    }
    save();
    return existing;
  },

  deleteDraft(schema: string | null, name: string | null) {
    const d = load();
    d.drafts = d.drafts.filter((x) => !((x.schema ?? null) === (schema ?? null) && (x.name ?? null) === (name ?? null)));
    save();
  },

  // ---- parameter sets
  paramSets(schema?: string, name?: string): ParameterSet[] {
    return load()
      .paramSets.filter((p) => (!schema || p.schema === schema) && (!name || p.name === name))
      .sort((a, b) => a.label.localeCompare(b.label));
  },

  saveParamSet(schema: string, name: string, label: string, parameters: Record<string, unknown>): ParameterSet {
    const d = load();
    const p: ParameterSet = { id: nextId(d), schema, name, label: label.trim(), parameters, createdAt: now() };
    d.paramSets.push(p);
    save();
    return p;
  },

  deleteParamSet(id: number) {
    const d = load();
    d.paramSets = d.paramSets.filter((p) => p.id !== id);
    save();
  },

  // ---- favorites
  favorites(): Favorite[] {
    return [...load().favorites];
  },

  addFavorite(kind: Favorite['kind'], schema: string, name: string) {
    const d = load();
    if (!d.favorites.some((f) => f.kind === kind && f.schema === schema && f.name === name)) {
      d.favorites.push({ kind, schema, name, createdAt: now() });
      save();
    }
  },

  removeFavorite(kind: Favorite['kind'], schema: string, name: string) {
    const d = load();
    d.favorites = d.favorites.filter((f) => !(f.kind === kind && f.schema === schema && f.name === name));
    save();
  },

  // ---- saved connections (secrets are kept, but never returned)
  connections(): SavedConnection[] {
    return load()
      .connections.map(({ secret: _s, ...c }) => c)
      .sort((a, b) => a.name.localeCompare(b.name));
  },

  saveConnection(input: {
    name: string;
    dbType?: string;
    connectionString?: string;
    server?: string;
    port?: number;
    database?: string;
    authType?: string;
    user?: string;
    password?: string;
    trustServerCertificate?: boolean;
    encrypt?: boolean;
  }): SavedConnection {
    const d = load();
    const name = input.name.trim();
    if (!name) throw new Error('A connection name is required.');
    const hasCs = Boolean(input.connectionString?.trim());
    let c = d.connections.find((x) => x.name.toLowerCase() === name.toLowerCase());
    const prevSecret = c?.secret ?? {};
    const fields = {
      name,
      dbType: input.dbType ?? 'sqlserver',
      server: hasCs ? null : input.server ?? null,
      port: hasCs ? null : input.port ?? null,
      database: hasCs ? null : input.database ?? null,
      authType: input.authType ?? null,
      user: input.user ?? null,
      usesConnectionString: hasCs || (c?.usesConnectionString && !input.server) || false,
      trustServerCertificate: input.trustServerCertificate ?? true,
      encrypt: input.encrypt ?? false,
      updatedAt: now(),
    };
    const secret = {
      ...prevSecret,
      ...(input.password ? { password: input.password } : {}),
      ...(hasCs ? { connectionString: input.connectionString } : {}),
    };
    if (c) Object.assign(c, fields, { secret, hasPassword: Boolean(secret.password) });
    else {
      c = { id: nextId(d), createdAt: now(), hasPassword: Boolean(secret.password), ...fields, secret };
      d.connections.push(c);
    }
    save();
    simUserData.log('info', 'UserStore', `Saved connection '${name}'`);
    const { secret: _s, ...pub } = c;
    return pub;
  },

  connectionSettings(id: number): Record<string, unknown> {
    const c = load().connections.find((x) => x.id === id);
    if (!c) throw new Error('Saved connection not found.');
    return {
      dbType: c.dbType,
      server: c.server ?? undefined,
      port: c.port ?? undefined,
      database: c.database ?? undefined,
      authType: c.authType ?? undefined,
      user: c.user ?? undefined,
      trustServerCertificate: c.trustServerCertificate,
      encrypt: c.encrypt,
      ...(c.secret ?? {}),
    };
  },

  deleteConnection(id: number) {
    const d = load();
    d.connections = d.connections.filter((c) => c.id !== id);
    save();
  },
};
