import { request, type ConnectionSettings, type ConnectionStatus } from './api';
import type {
  Draft,
  ExecutionRecord,
  ExecutionRecordSummary,
  Favorite,
  LogPage,
  ParameterSet,
  SavedConnection,
} from './userDataTypes';

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
} from './userDataTypes';

function qs(params: Record<string, string | number | boolean | undefined | null>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : '';
}

// ---- settings (profile, theme, tourSeen) ----
export type StoredSettings = Record<string, unknown>;

export const settingsApi = {
  get: (): Promise<StoredSettings> => request<StoredSettings>('GET', '/api/settings'),
  put: (patch: StoredSettings): Promise<StoredSettings> => request<StoredSettings>('PUT', '/api/settings', patch),
};

/** Fire-and-forget save; the renderer's localStorage copy stays authoritative if the save fails. */
export function pushSettings(patch: StoredSettings): void {
  settingsApi.put(patch).catch(() => {
    /* backend unavailable: localStorage still has the value */
  });
}

// ---- saved connections -------------------------------------------------------------------------
export interface SaveConnectionInput extends ConnectionSettings {
  name: string;
}

export const savedConnectionsApi = {
  list: (): Promise<SavedConnection[]> =>
    request('GET', '/api/connections/saved'),

  save: (input: SaveConnectionInput): Promise<SavedConnection> => {
    const { createDatabase: _c, ...body } = input;
    return request('POST', '/api/connections/saved', body);
  },

  apply: (id: number, createDatabase = false): Promise<ConnectionStatus> =>
    request('POST', `/api/connections/saved/${id}/apply`, { createDatabase }),

  remove: (id: number): Promise<void> =>
    request('DELETE', `/api/connections/saved/${id}`),
};

// ---- drafts ------------------------------------------------------------------------------------------
export const draftsApi = {
  get: async (schema: string | null, name: string | null): Promise<Draft | null> => {
    const list = await request<Draft[]>('GET', `/api/drafts${qs({ schema, name })}`);
    return list[0] ?? null;
  },
  save: (schema: string | null, name: string | null, script: string): Promise<Draft> =>
    request('PUT', '/api/drafts', { schema, name, script }),
  discard: (schema: string | null, name: string | null): Promise<void> =>
    request('DELETE', `/api/drafts${qs({ schema, name })}`),
};

// ---- execution history ---------------------------------------------------------------------------------------
export const historyApi = {
  list: (q: { schema?: string; name?: string; limit?: number; before?: number } = {}): Promise<ExecutionRecordSummary[]> =>
    request('GET', `/api/history${qs(q)}`),
  get: (id: number): Promise<ExecutionRecord> =>
    request('GET', `/api/history/${id}`),
  clear: (q: { schema?: string; name?: string } = {}): Promise<{ cleared: number }> =>
    request('POST', `/api/history/clear${qs(q)}`),
};

// ---- parameter sets ---------------------------------------------------------------------------------------------------
export const parameterSetsApi = {
  list: (schema?: string, name?: string): Promise<ParameterSet[]> =>
    request('GET', `/api/parameter-sets${qs({ schema, name })}`),
  save: (schema: string, name: string, label: string, parameters: Record<string, unknown>): Promise<ParameterSet> =>
    request('POST', '/api/parameter-sets', { schema, name, label, parameters }),
  remove: (id: number): Promise<void> =>
    request('DELETE', `/api/parameter-sets/${id}`),
};

// ---- favorites ---------------------------------------------------------------------------------------------------------------
export const favoritesApi = {
  list: (): Promise<Favorite[]> =>
    request('GET', '/api/favorites'),
  add: (kind: Favorite['kind'], schema: string, name: string): Promise<void> =>
    request('PUT', '/api/favorites', { kind, schema, name }),
  remove: (kind: Favorite['kind'], schema: string, name: string): Promise<void> =>
    request('DELETE', `/api/favorites${qs({ kind, schema, name })}`),
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
    request('GET', `/api/logs${qs({ ...q })}`),
  categories: (): Promise<string[]> =>
    request('GET', '/api/logs/categories'),
  clear: (): Promise<{ cleared: number }> =>
    request('POST', '/api/logs/clear'),
};
