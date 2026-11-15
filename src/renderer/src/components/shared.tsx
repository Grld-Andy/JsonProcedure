import React, { ReactNode, useEffect, useRef, useState } from 'react';
import { AlertTriangle, Check, Copy, Download, Trash2, X } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { type ExecutionResult, type ResultSet, resultToJson } from '../lib/api';

export function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export function Field({
  label,
  children,
  className = '',
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={`grid gap-1.5 ${className}`}>
      <span className="text-xs font-medium text-slate-600 dark:text-slate-300">{label}</span>
      {children}
    </label>
  );
}

export const inputClass =
  'w-full rounded-lg border border-[#D8E1EC] dark:border-[#2C3A52] bg-[#F8FAFC] dark:bg-[#1D283B] px-3 py-2 text-sm text-[#172033] dark:text-[#E6ECF5] placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/25 focus:border-blue-600 transition-colors disabled:opacity-50';

export const selectClass =
  'w-full rounded-lg border border-[#D8E1EC] dark:border-[#2C3A52] bg-[#F8FAFC] dark:bg-[#1D283B] px-3 py-2 text-sm text-[#172033] dark:text-[#E6ECF5] focus:outline-none focus:ring-2 focus:ring-blue-500/25 focus:border-blue-600 transition-colors disabled:opacity-50';

export function JsonView({
  value,
  maxHeight = 420,
  fileName = 'result.json',
}: {
  value: unknown;
  maxHeight?: number;
  fileName?: string;
}) {
  const [copied, setCopied] = useState(false);
  const text = JSON.stringify(value, null, 2) ?? 'null';

  const copy = async () => {
    await navigator.clipboard?.writeText(text).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  const download = () => {
    const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="grid gap-2.5">
      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={copy}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[#D8E1EC] dark:border-[#2C3A52] bg-white dark:bg-[#1D283B] text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-[#243147] transition-colors cursor-pointer whitespace-nowrap"
        >
          {copied ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5 text-slate-400" />}
          <span>{copied ? 'Copied' : 'Copy JSON'}</span>
        </button>
        <button
          type="button"
          onClick={download}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[#D8E1EC] dark:border-[#2C3A52] bg-white dark:bg-[#1D283B] text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-[#243147] transition-colors cursor-pointer whitespace-nowrap"
        >
          <Download className="h-3.5 w-3.5 text-slate-400" />
          <span>Download JSON</span>
        </button>
      </div>
      <pre
        className="overflow-auto rounded-xl border border-[#E2E8F0] dark:border-[#243147] bg-[#F8FAFC] dark:bg-[#111927] p-4 font-mono text-xs leading-relaxed text-[#172033] dark:text-[#E6ECF5]"
        style={{ maxHeight }}
      >
        {text}
      </pre>
    </div>
  );
}

function renderCell(v: unknown) {
  if (v === null || v === undefined) {
    return <span className="text-slate-400 italic">NULL</span>;
  }
  if (typeof v === 'object') return JSON.stringify(v);
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  return String(v);
}

export function DataGrid({
  set,
  maxHeight = 380,
  selectable = false,
  selectedIndices,
  onToggleRow,
  onToggleAll,
}: {
  set: ResultSet;
  maxHeight?: number;
  selectable?: boolean;
  selectedIndices?: Set<number>;
  onToggleRow?: (index: number) => void;
  onToggleAll?: () => void;
}) {
  const selectAllRef = useRef<HTMLInputElement>(null);
  const totalRows = set.rows.length;
  const selectedCount =
    selectable && selectedIndices
      ? set.rows.reduce((n, _, idx) => n + (selectedIndices.has(idx) ? 1 : 0), 0)
      : 0;
  const allSelected = totalRows > 0 && selectedCount === totalRows;
  const someSelected = selectedCount > 0 && selectedCount < totalRows;

  useEffect(() => {
    if (selectAllRef.current) {
      selectAllRef.current.indeterminate = someSelected;
    }
  }, [someSelected]);

  if (set.json !== null && set.json !== undefined) {
    return <JsonView value={set.json} maxHeight={maxHeight} />;
  }
  if (set.columns.length === 0) {
    return <p className="text-xs text-slate-500 dark:text-slate-400">No columns.</p>;
  }
  return (
    <div
      className="overflow-auto rounded-xl border border-[#E2E8F0] dark:border-[#243147]"
      style={{ maxHeight }}
    >
      <table className="w-full text-left border-collapse">
        <thead>
          <tr className="border-b border-[#E2E8F0] dark:border-[#243147] bg-[#F8FAFC] dark:bg-[#1D283B]/75 sticky top-0 z-10">
            {selectable && (
              <th className="w-10 py-2.5 px-3 text-center">
                <input
                  ref={selectAllRef}
                  type="checkbox"
                  checked={allSelected}
                  disabled={totalRows === 0}
                  onChange={() => onToggleAll?.()}
                  aria-label="Select all visible rows"
                  className="rounded border-slate-300 dark:border-slate-600 text-blue-600 focus:ring-blue-500 cursor-pointer disabled:opacity-40"
                />
              </th>
            )}
            {set.columns.map((c) => (
              <th
                key={c}
                className="py-2.5 px-4 text-xs font-semibold text-[#172033] dark:text-[#E6ECF5] whitespace-nowrap"
              >
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-[#E2E8F0] dark:divide-[#243147] text-xs font-mono">
          {set.rows.length === 0 ? (
            <tr>
              <td
                colSpan={set.columns.length + (selectable ? 1 : 0)}
                className="py-8 px-4 text-center font-sans text-slate-500 dark:text-slate-400"
              >
                No rows in this table.
              </td>
            </tr>
          ) : (
            set.rows.map((r, i) => {
              const isSelected = Boolean(selectable && selectedIndices?.has(i));
              return (
                <tr
                  key={i}
                  className={`transition-colors ${
                    isSelected
                      ? 'bg-blue-50/75 dark:bg-blue-950/35'
                      : 'hover:bg-[#F8FAFC] dark:hover:bg-[#1D283B]/45'
                  }`}
                >
                  {selectable && (
                    <td className="w-10 py-2.5 px-3 text-center">
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => onToggleRow?.(i)}
                        aria-label={`Select row ${i + 1}`}
                        className="rounded border-slate-300 dark:border-slate-600 text-blue-600 focus:ring-blue-500 cursor-pointer"
                      />
                    </td>
                  )}
                  {set.columns.map((c) => {
                    const val = r[c];
                    return (
                      <td
                        key={c}
                        className="py-2.5 px-4 whitespace-nowrap tabular-nums text-left text-[#172033] dark:text-[#E6ECF5]"
                      >
                        {renderCell(val)}
                      </td>
                    );
                  })}
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
}

export function DataGridSkeleton({
  columns = 5,
  rows = 5,
}: {
  columns?: number;
  rows?: number;
}) {
  return (
    <div
      aria-busy="true"
      aria-label="Loading table data"
      className="overflow-hidden rounded-xl border border-[#E2E8F0] dark:border-[#243147] animate-pulse"
    >
      <div className="border-b border-[#E2E8F0] dark:border-[#243147] bg-[#F8FAFC] dark:bg-[#1D283B]/75 px-4 py-3 grid gap-4" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
        {Array.from({ length: columns }).map((_, c) => (
          <div key={c} className="h-3 w-20 max-w-full rounded bg-slate-200 dark:bg-slate-700" />
        ))}
      </div>
      <div className="divide-y divide-[#E2E8F0] dark:divide-[#243147] bg-white dark:bg-[#161F30]">
        {Array.from({ length: rows }).map((_, r) => (
          <div
            key={r}
            className="px-4 py-3 grid gap-4"
            style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
          >
            {Array.from({ length: columns }).map((_, c) => (
              <div
                key={c}
                className={`h-3.5 rounded bg-slate-100 dark:bg-slate-800 ${
                  c === 0 ? 'w-14' : c % 2 === 0 ? 'w-28' : 'w-20'
                } max-w-full`}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

export function SidebarListSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div aria-busy="true" aria-label="Loading items" className="divide-y divide-[#EEF2F7] dark:divide-[#243147] animate-pulse">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center justify-between gap-2 px-4 py-3">
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <div className="h-3.5 w-3.5 shrink-0 rounded bg-slate-200 dark:bg-slate-700" />
            <div className="h-3.5 rounded bg-slate-200/80 dark:bg-slate-700/70" style={{ width: `${55 + (i % 3) * 14}%` }} />
          </div>
          <div className="h-3 w-6 shrink-0 rounded bg-slate-100 dark:bg-slate-800" />
        </div>
      ))}
    </div>
  );
}

export function ExecutionView({
  result,
  procedureName,
}: {
  result: ExecutionResult;
  procedureName?: string;
}) {
  const [tab, setTab] = useState<'json' | 'table'>('json');
  const fileName = procedureName ? `${procedureName}.json` : 'procedure-result.json';

  return (
    <div className="grid gap-3.5 pt-2 border-t border-[#E2E8F0] dark:border-[#243147]">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex items-center gap-1 p-1 rounded-lg bg-[#EEF2F7] dark:bg-[#1D283B]">
          <button
            type="button"
            onClick={() => setTab('json')}
            className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors cursor-pointer whitespace-nowrap ${
              tab === 'json'
                ? 'bg-white dark:bg-[#161F30] text-[#172033] dark:text-white shadow-xs'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            JSON Output
          </button>
          <button
            type="button"
            onClick={() => setTab('table')}
            className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors cursor-pointer whitespace-nowrap ${
              tab === 'table'
                ? 'bg-white dark:bg-[#161F30] text-[#172033] dark:text-white shadow-xs'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            Table View
          </button>
        </div>

        <p className="text-xs text-slate-500 dark:text-slate-400 tabular-nums">
          {result.resultSets.length} result set(s) · {result.elapsedMs} ms
          {result.returnValue !== null ? ` · return value ${result.returnValue}` : ''}
        </p>
      </div>

      {tab === 'json' ? (
        <JsonView value={resultToJson(result)} fileName={fileName} />
      ) : (
        <div className="grid gap-4">
          {result.resultSets.map((s, i) => (
            <div key={i} className="grid gap-1.5">
              <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
                Result set {i + 1} ({s.rows.length} rows)
              </span>
              <DataGrid set={s} />
            </div>
          ))}
          {Object.keys(result.outputParameters).length > 0 && (
            <div className="grid gap-1.5">
              <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
                Output parameters
              </span>
              <JsonView value={result.outputParameters} maxHeight={180} fileName="output-params.json" />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function ConfirmModal({
  open,
  title,
  description,
  confirmLabel,
  requiredConfirmation,
  acceptedConfirmations,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  requiredConfirmation?: string;
  acceptedConfirmations?: string[];
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const [typed, setTyped] = useState('');

  useEffect(() => {
    if (!open) setTyped('');
  }, [open]);

  const validTargets = [
    ...(requiredConfirmation ? [requiredConfirmation] : []),
    ...(acceptedConfirmations ?? []),
  ].map((s) => s.trim().toLowerCase());

  const canConfirm =
    validTargets.length === 0 || validTargets.includes(typed.trim().toLowerCase());

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/45 backdrop-blur-[1px]"
          role="dialog"
          aria-modal="true"
          onClick={onCancel}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 10 }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md rounded-xl bg-white dark:bg-[#161F30] border border-[#E2E8F0] dark:border-[#243147] shadow-lg p-5 space-y-4"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-900/60 text-rose-600 dark:text-rose-400">
                  <AlertTriangle className="h-4 w-4" />
                </div>
                <h3 className="font-display text-base font-semibold text-[#172033] dark:text-[#F1F5F9]">
                  {title}
                </h3>
              </div>
              <button
                type="button"
                onClick={onCancel}
                aria-label="Close modal"
                className="inline-flex items-center gap-1 rounded-lg border border-[#E2E8F0] dark:border-[#2C3A52] px-2 py-1 text-xs font-medium text-slate-500 hover:bg-slate-100 dark:hover:bg-[#1D283B] cursor-pointer shrink-0 transition-transform active:scale-95"
              >
                <X className="h-3.5 w-3.5" />
                <span>Close</span>
              </button>
            </div>

            <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">{description}</p>

            {requiredConfirmation && (
              <div className="rounded-lg border border-rose-200 dark:border-rose-900/60 bg-rose-50/70 dark:bg-rose-950/25 p-3.5 space-y-2.5">
                <p className="text-xs text-rose-900 dark:text-rose-200 leading-relaxed">
                  If you want to continue, enter{' '}
                  <code className="rounded bg-white/80 dark:bg-[#111927] px-1.5 py-0.5 font-mono text-[11px] font-semibold text-rose-700 dark:text-rose-300 border border-rose-200/80 dark:border-rose-800/70">
                    {requiredConfirmation}
                  </code>
                </p>
                <input
                  type="text"
                  value={typed}
                  onChange={(e) => setTyped(e.target.value)}
                  placeholder={requiredConfirmation}
                  autoFocus
                  className="w-full rounded-lg border border-rose-300 dark:border-rose-800 bg-white dark:bg-[#111927] px-3 py-2 font-mono text-xs text-[#172033] dark:text-[#F1F5F9] placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-rose-500/25 focus:border-rose-500"
                />
              </div>
            )}

            <div className="flex justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={onCancel}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg border border-[#E2E8F0] dark:border-[#2C3A52] text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-[#1D283B] cursor-pointer transition-transform active:scale-95"
              >
                <X className="h-3.5 w-3.5" />
                <span>Cancel</span>
              </button>
              <button
                type="button"
                onClick={onConfirm}
                disabled={!canConfirm}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-rose-600 hover:bg-rose-700 text-xs font-semibold text-white cursor-pointer disabled:opacity-45 disabled:cursor-not-allowed transition-transform active:scale-95"
              >
                <Trash2 className="h-3.5 w-3.5" />
                <span>{confirmLabel}</span>
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
