/** Shapes returned by the backend's user store (saved connections, drafts, history, parameter sets, favorites, logs). */

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
