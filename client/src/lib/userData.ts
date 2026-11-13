import { getApiConfig, request, type ConnectionSettings, type ConnectionStatus } from './api';
import { simBackend } from './mockSimulation';
import {
  simUserData,
  type Draft,
  type ExecutionRecord,
  type ExecutionRecordSummary,
  type Favorite,
  type LogPage,
  type ParameterSet,
  type SavedConnection,
} from './simUserData';

export type {
  Draft,
  ExecutionRecord,
  ExecutionRecordSummary,
  Favorite,
  LogEntry,
  LogLevel,
  LogPage,
  ParameterSet,
  SavedConnection,
} from './simUserData';

const live = () => getApiConfig().isLive;

function qs(params: Record<string, string | number | boolean | undefined | null>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : '';
}

// ---- settings (profile, theme, tourSeen). Simulation mode keeps these in localStorage already. ----
export type StoredSettings = Record<string, unknown>;

export const settingsApi = {
  get: (): Promise<StoredSettings> => (live() ? request<StoredSettings>('GET', '/api/settings') : Promise.resolve({})),
  put: (patch: StoredSettings): Promise<StoredSettings> =>
    live() ? request<StoredSettings>('PUT', '/api/settings', patch) : Promise.resolve(patch),
};

/** Fire-and-forget save; the browser copy stays authoritative if the server is unreachable. */
export function pushSettings(patch: StoredSettings): void {
  if (!live()) return;
  settingsApi.put(patch).catch(() => {
    /* offline or backend down: localStorage still has the value */
  });
}

// ---- saved connections -------------------------------------------------------------------------
export interface SaveConnectionInput extends ConnectionSettings {
  name: string;
}

export const savedConnectionsApi = {
  list: (): Promise<SavedConnection[]> =>
    live() ? request('GET', '/api/connections/saved') : Promise.resolve(simUserData.connections()),

  save: (input: SaveConnectionInput): Promise<SavedConnection> => {
    const { createDatabase: _c, ...body } = input;
    return live() ? request('POST', '/api/connections/saved', body) : Promise.resolve(simUserData.saveConnection(body));
  },

  apply: (id: number, createDatabase = false): Promise<ConnectionStatus> =>
    live()
      ? request('POST', `/api/connections/saved/${id}/apply`, { createDatabase })
      : simBackend.applyConnection({ ...simUserData.connectionSettings(id), createDatabase } as ConnectionSettings),

  remove: (id: number): Promise<void> =>
    live()
      ? request('DELETE', `/api/connections/saved/${id}`)
      : Promise.resolve(simUserData.deleteConnection(id)),
};

// ---- drafts ------------------------------------------------------------------------------------------
export const draftsApi = {
  get: async (schema: string | null, name: string | null): Promise<Draft | null> => {
    const list = live()
      ? await request<Draft[]>('GET', `/api/drafts${qs({ schema, name })}`)
      : simUserData.draft(schema, name);
    return list[0] ?? null;
  },
  save: (schema: string | null, name: string | null, script: string): Promise<Draft> =>
    live()
      ? request('PUT', '/api/drafts', { schema, name, script })
      : Promise.resolve(simUserData.saveDraft(schema, name, script)),
  discard: (schema: string | null, name: string | null): Promise<void> =>
    live()
      ? request('DELETE', `/api/drafts${qs({ schema, name })}`)
      : Promise.resolve(simUserData.deleteDraft(schema, name)),
};

// ---- execution history ---------------------------------------------------------------------------------------
export const historyApi = {
  list: (q: { schema?: string; name?: string; limit?: number; before?: number } = {}): Promise<ExecutionRecordSummary[]> =>
    live() ? request('GET', `/api/history${qs(q)}`) : Promise.resolve(simUserData.history(q)),
  get: (id: number): Promise<ExecutionRecord> =>
    live() ? request('GET', `/api/history/${id}`) : Promise.resolve(simUserData.execution(id)),
  clear: (q: { schema?: string; name?: string } = {}): Promise<{ cleared: number }> =>
    live() ? request('POST', `/api/history/clear${qs(q)}`) : Promise.resolve(simUserData.clearHistory(q)),
};

// ---- parameter sets ---------------------------------------------------------------------------------------------------
export const parameterSetsApi = {
  list: (schema?: string, name?: string): Promise<ParameterSet[]> =>
    live() ? request('GET', `/api/parameter-sets${qs({ schema, name })}`) : Promise.resolve(simUserData.paramSets(schema, name)),
  save: (schema: string, name: string, label: string, parameters: Record<string, unknown>): Promise<ParameterSet> =>
    live()
      ? request('POST', '/api/parameter-sets', { schema, name, label, parameters })
      : Promise.resolve(simUserData.saveParamSet(schema, name, label, parameters)),
  remove: (id: number): Promise<void> =>
    live() ? request('DELETE', `/api/parameter-sets/${id}`) : Promise.resolve(simUserData.deleteParamSet(id)),
};

// ---- favorites ---------------------------------------------------------------------------------------------------------------
export const favoritesApi = {
  list: (): Promise<Favorite[]> =>
    live() ? request('GET', '/api/favorites') : Promise.resolve(simUserData.favorites()),
  add: (kind: Favorite['kind'], schema: string, name: string): Promise<void> =>
    live()
      ? request('PUT', '/api/favorites', { kind, schema, name })
      : Promise.resolve(simUserData.addFavorite(kind, schema, name)),
  remove: (kind: Favorite['kind'], schema: string, name: string): Promise<void> =>
    live()
      ? request('DELETE', `/api/favorites${qs({ kind, schema, name })}`)
      : Promise.resolve(simUserData.removeFavorite(kind, schema, name)),
};

export const favKey = (schema: string, name: string) => `${schema}.${name}`.toLowerCase();

// ---- logs --------------------------------------------------------------------------------------------------------------------------
export interface LogQuery {
  level?: string;
  category?: string;
  q?: string;
  before?: number;
  limit?: number;
}

export const logsApi = {
  list: (q: LogQuery = {}): Promise<LogPage> =>
    live() ? request('GET', `/api/logs${qs({ ...q })}`) : Promise.resolve(simUserData.logs(q)),
  categories: (): Promise<string[]> =>
    live() ? request('GET', '/api/logs/categories') : Promise.resolve(simUserData.logCategories()),
  clear: (): Promise<{ cleared: number }> =>
    live() ? request('POST', '/api/logs/clear') : Promise.resolve(simUserData.clearLogs()),
};
