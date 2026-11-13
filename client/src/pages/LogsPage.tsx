import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronRight, RefreshCw, Search, Trash2 } from 'lucide-react';
import { logsApi, type LogEntry, type LogLevel } from '../lib/userData';

interface LogsPageProps {
  refreshKey: number;
  isLive: boolean;
  onNotify: (text: string, tone?: 'success' | 'error') => void;
}

const LEVELS: { id: string; label: string }[] = [
  { id: 'debug', label: 'Debug and above' },
  { id: 'info', label: 'Info and above' },
  { id: 'warning', label: 'Warnings and errors' },
  { id: 'error', label: 'Errors only' },
];

const LEVEL_STYLE: Record<LogLevel, string> = {
  debug: 'bg-slate-100 text-slate-600 dark:bg-slate-700/50 dark:text-slate-300',
  info: 'bg-blue-50 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300',
  warning: 'bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300',
  error: 'bg-rose-50 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300',
  critical: 'bg-rose-100 text-rose-800 dark:bg-rose-500/25 dark:text-rose-200',
};

const PAGE_SIZE = 100;

function formatTime(ts: string): string {
  const d = new Date(ts);
  return Number.isNaN(d.getTime()) ? ts : d.toLocaleString();
}

export function LogsPage({ refreshKey, isLive, onNotify }: LogsPageProps) {
  const [items, setItems] = useState<LogEntry[]>([]);
  const [next, setNext] = useState<number | null>(null);
  const [level, setLevel] = useState('info');
  const [category, setCategory] = useState('');
  const [categories, setCategories] = useState<string[]>([]);
  const [search, setSearch] = useState('');
  const [auto, setAuto] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [confirmClear, setConfirmClear] = useState(false);
  const requestId = useRef(0);

  const load = useCallback(
    async (opts: { silent?: boolean } = {}) => {
      const id = ++requestId.current;
      if (!opts.silent) setLoading(true);
      try {
        const [page, cats] = await Promise.all([
          logsApi.list({ level, category: category || undefined, q: search.trim() || undefined, limit: PAGE_SIZE }),
          logsApi.categories(),
        ]);
        if (id !== requestId.current) return;
        setItems(page.items);
        setNext(page.nextBefore);
        setCategories(cats);
        setError(null);
      } catch (e) {
        if (id === requestId.current) setError(e instanceof Error ? e.message : 'Could not load logs.');
      } finally {
        if (id === requestId.current) setLoading(false);
      }
    },
    [level, category, search]
  );

  // Reload when a filter changes (search is debounced) or the workspace is refreshed.
  useEffect(() => {
    const t = window.setTimeout(() => void load(), search ? 250 : 0);
    return () => window.clearTimeout(t);
  }, [load, refreshKey]);

  useEffect(() => {
    if (!auto) return;
    const t = window.setInterval(() => void load({ silent: true }), 3000);
    return () => window.clearInterval(t);
  }, [auto, load]);

  const loadMore = async () => {
    if (next === null) return;
    try {
      const page = await logsApi.list({
        level,
        category: category || undefined,
        q: search.trim() || undefined,
        before: next,
        limit: PAGE_SIZE,
      });
      setItems((prev) => [...prev, ...page.items]);
      setNext(page.nextBefore);
    } catch (e) {
      onNotify(e instanceof Error ? e.message : 'Could not load more logs.', 'error');
    }
  };

  const clearAll = async () => {
    try {
      const { cleared } = await logsApi.clear();
      setConfirmClear(false);
      setExpanded(new Set());
      onNotify(`Cleared ${cleared} log ${cleared === 1 ? 'entry' : 'entries'}`);
      await load();
    } catch (e) {
      onNotify(e instanceof Error ? e.message : 'Could not clear logs.', 'error');
    }
  };

  const toggle = (id: number) =>
    setExpanded((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const inputCls =
    'h-9 rounded-lg border border-[#D8E1EC] dark:border-[#2C3A52] bg-white dark:bg-[#0F1623] px-3 text-xs text-[#172033] dark:text-[#E6ECF5] focus:outline-none focus:ring-2 focus:ring-blue-500/40';

  return (
    <div className="space-y-4">
      <div className="rounded-xl bg-white dark:bg-[#161F30] border border-[#E6EBF2] dark:border-[#243147] p-4">
        <div className="flex flex-wrap items-center gap-2.5">
          <div className="relative min-w-[200px] flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search messages and details"
              aria-label="Search logs"
              className={`${inputCls} w-full pl-8`}
            />
          </div>
          <select value={level} onChange={(e) => setLevel(e.target.value)} aria-label="Minimum level" className={inputCls}>
            {LEVELS.map((l) => (
              <option key={l.id} value={l.id}>
                {l.label}
              </option>
            ))}
          </select>
          <select value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Category" className={inputCls}>
            <option value="">All categories</option>
            {categories.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <label className="inline-flex h-9 cursor-pointer items-center gap-2 rounded-lg border border-[#D8E1EC] dark:border-[#2C3A52] px-3 text-xs text-slate-600 dark:text-slate-300">
            <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} />
            Auto-refresh
          </label>
          <button
            type="button"
            onClick={() => void load()}
            className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-lg border border-[#D8E1EC] dark:border-[#2C3A52] px-3 text-xs font-medium text-slate-600 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-[#1D283B]"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
          {confirmClear ? (
            <span className="inline-flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300">
              Delete all log entries?
              <button
                type="button"
                onClick={() => void clearAll()}
                className="cursor-pointer rounded-lg bg-rose-600 px-3 py-2 text-xs font-semibold text-white hover:bg-rose-700"
              >
                Yes, clear
              </button>
              <button
                type="button"
                onClick={() => setConfirmClear(false)}
                className="cursor-pointer rounded-lg border border-[#D8E1EC] dark:border-[#2C3A52] px-3 py-2 text-xs"
              >
                Cancel
              </button>
            </span>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmClear(true)}
              className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-lg border border-[#D8E1EC] dark:border-[#2C3A52] px-3 text-xs font-medium text-slate-600 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-[#1D283B]"
            >
              <Trash2 className="h-3.5 w-3.5" />
              Clear logs
            </button>
          )}
        </div>
        <p className="mt-2.5 text-[11px] text-slate-500 dark:text-slate-400">
          {isLive
            ? 'Server activity, stored in the backend SQLite database (newest 10,000 entries, 30 days).'
            : 'Simulation mode: activity from this browser only. Switch to the live backend to see server logs.'}
        </p>
      </div>

      <div className="overflow-hidden rounded-xl bg-white dark:bg-[#161F30] border border-[#E6EBF2] dark:border-[#243147]">
        {error ? (
          <p className="p-6 text-center text-xs text-rose-600 dark:text-rose-400">{error}</p>
        ) : items.length === 0 ? (
          <p className="p-10 text-center text-xs text-slate-500 dark:text-slate-400">
            {loading ? 'Loading logs…' : 'No log entries match these filters.'}
          </p>
        ) : (
          <ul className="divide-y divide-[#E6EBF2] dark:divide-[#243147]">
            {items.map((l) => {
              const open = expanded.has(l.id);
              const hasDetails = l.details !== null && l.details !== undefined;
              return (
                <li key={l.id} className="text-xs">
                  <button
                    type="button"
                    onClick={() => hasDetails && toggle(l.id)}
                    aria-expanded={hasDetails ? open : undefined}
                    className={`flex w-full items-start gap-3 px-4 py-2.5 text-left ${
                      hasDetails ? 'cursor-pointer hover:bg-slate-50 dark:hover:bg-[#1D283B]' : 'cursor-default'
                    }`}
                  >
                    <span className="mt-0.5 w-3.5 shrink-0 text-slate-400">
                      {hasDetails ? open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" /> : null}
                    </span>
                    <span className="w-40 shrink-0 tabular-nums text-slate-500 dark:text-slate-400">{formatTime(l.ts)}</span>
                    <span
                      className={`w-16 shrink-0 rounded px-1.5 py-0.5 text-center text-[10px] font-semibold uppercase ${
                        LEVEL_STYLE[l.level] ?? LEVEL_STYLE.info
                      }`}
                    >
                      {l.level}
                    </span>
                    <span className="hidden w-32 shrink-0 truncate text-slate-500 dark:text-slate-400 md:inline" title={l.category}>
                      {l.category}
                    </span>
                    <span className="min-w-0 flex-1 break-words text-[#172033] dark:text-[#E6ECF5]">{l.message}</span>
                    {l.durationMs !== null && (
                      <span className="shrink-0 tabular-nums text-slate-400">{l.durationMs} ms</span>
                    )}
                  </button>
                  {open && hasDetails && (
                    <pre className="mx-4 mb-3 ml-[3.25rem] overflow-x-auto rounded-lg bg-slate-50 p-3 font-mono text-[11px] text-slate-700 dark:bg-[#0F1623] dark:text-slate-300">
                      {JSON.stringify(l.details, null, 2)}
                    </pre>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        {next !== null && (
          <div className="border-t border-[#E6EBF2] dark:border-[#243147] p-3 text-center">
            <button
              type="button"
              onClick={() => void loadMore()}
              className="cursor-pointer rounded-lg border border-[#D8E1EC] dark:border-[#2C3A52] px-4 py-2 text-xs font-medium text-slate-600 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-[#1D283B]"
            >
              Load older entries
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
