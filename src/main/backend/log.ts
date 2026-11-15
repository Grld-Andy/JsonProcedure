import { nowIso } from './errors.ts';

export interface LogRow {
  ts: string;
  level: string;
  levelNo: number;
  category: string;
  message: string;
  detailsJson: string | null;
  durationMs: number | null;
  statusCode: number | null;
}

export function levelNo(level: string | null | undefined): number {
  switch (level?.toLowerCase()) {
    case 'trace': return 0;
    case 'debug': return 1;
    case 'information': case 'info': return 2;
    case 'warning': case 'warn': return 3;
    case 'error': return 4;
    case 'critical': return 5;
    default: return 0;
  }
}

const MAX_QUEUE = 5000;
const BATCH = 200;

/**
 * In-memory queue between the app and the SQLite log writer: rows accumulate for a moment
 * and are written in batches, so logging never slows a request down.
 */
export class LogSink {
  private queue: LogRow[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private writer: ((rows: LogRow[]) => void) | null = null;

  attach(writer: (rows: LogRow[]) => void): void {
    this.writer = writer;
    if (this.queue.length) this.schedule();
  }

  write(
    level: string,
    category: string,
    message: string,
    details?: unknown,
    durationMs?: number | null,
    statusCode?: number | null,
  ): void {
    let detailsJson: string | null = null;
    if (details !== undefined && details !== null) {
      try { detailsJson = JSON.stringify(details); } catch { /* unserialisable details are dropped */ }
    }
    this.queue.push({
      ts: nowIso(), level, levelNo: levelNo(level), category,
      message: message.length > 4000 ? message.slice(0, 4000) : message,
      detailsJson, durationMs: durationMs ?? null, statusCode: statusCode ?? null,
    });
    if (this.queue.length > MAX_QUEUE) this.queue.splice(0, this.queue.length - MAX_QUEUE); // drop oldest
    this.schedule();
  }

  info(category: string, message: string, details?: unknown): void { this.write('info', category, message, details); }
  warn(category: string, message: string, details?: unknown): void { this.write('warning', category, message, details); }
  error(category: string, message: string, details?: unknown): void { this.write('error', category, message, details); }

  private schedule(): void {
    if (this.timer || !this.writer) return;
    this.timer = setTimeout(() => { this.timer = null; this.flush(); }, 250);
    this.timer.unref?.();
  }

  /** Writes everything queued now. Never throws: logging must not break the app. */
  flush(): void {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    if (!this.writer) return;
    while (this.queue.length) {
      const batch = this.queue.splice(0, BATCH);
      try { this.writer(batch); } catch { /* best effort */ }
    }
  }
}
