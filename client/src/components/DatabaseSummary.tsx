import { useMemo, useState } from 'react';
import {
  ChevronDown,
  ChevronUp,
  Database,
  HardDrive,
  Layers,
  Rows3,
  Table2,
} from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import type { TableColumnInfo, TableInfo } from '../lib/api';

export interface TableStorageStat {
  key: string;
  schema: string;
  name: string;
  rowCount: number;
  columnCount: number;
  estimatedRowBytes: number;
  sizeBytes: number;
  sizeMb: number;
  sharePercent: number;
}

export interface DatabaseStats {
  tableCount: number;
  populatedTableCount: number;
  totalColumns: number;
  totalRows: number;
  totalSizeBytes: number;
  totalSizeKb: number;
  totalSizeMb: number;
  avgRowsPerTable: number;
  largestTable: TableStorageStat | null;
  perTable: TableStorageStat[];
}

function estimateColumnBytes(col: TableColumnInfo): number {
  const raw = col.type.trim().toLowerCase();
  const baseMatch = /^([a-z0-9_]+)/.exec(raw);
  const base = baseMatch ? baseMatch[1] : raw;
  const argMatch = /\(([^)]+)\)/.exec(raw);
  const arg = argMatch ? argMatch[1].trim() : '';

  switch (base) {
    case 'tinyint':
    case 'bit':
      return 1;
    case 'smallint':
      return 2;
    case 'date':
      return 3;
    case 'int':
    case 'real':
    case 'smallmoney':
      return 4;
    case 'time':
      return 5;
    case 'bigint':
    case 'float':
    case 'money':
    case 'datetime':
    case 'datetime2':
      return 8;
    case 'uniqueidentifier':
      return 16;
    case 'decimal':
    case 'numeric': {
      const precision = Number(arg.split(',')[0]) || 18;
      if (precision <= 9) return 5;
      if (precision <= 19) return 9;
      if (precision <= 28) return 13;
      return 17;
    }
    case 'nchar': {
      const len = Number(arg) || 10;
      return Math.min(len, 4000) * 2;
    }
    case 'char': {
      const len = Number(arg) || 10;
      return Math.min(len, 8000);
    }
    case 'nvarchar': {
      if (!arg || arg === 'max') return 128;
      const len = Number(arg) || 100;
      return Math.max(8, Math.round(Math.min(len, 128) * 0.5)) * 2;
    }
    case 'varchar': {
      if (!arg || arg === 'max') return 128;
      const len = Number(arg) || 100;
      return Math.max(8, Math.round(Math.min(len, 255) * 0.5));
    }
    case 'varbinary': {
      if (!arg || arg === 'max') return 128;
      const len = Number(arg) || 64;
      return Math.min(len, 256);
    }
    default:
      return 16;
  }
}

function estimateTableStorage(table: TableInfo): {
  estimatedRowBytes: number;
  sizeBytes: number;
} {
  const cols = table.columns ?? [];
  const variableCount = cols.filter((c) => {
    const t = c.type.toLowerCase();
    return t.startsWith('nvarchar') || t.startsWith('varchar') || t.startsWith('varbinary');
  }).length;

  const dataBytesPerRow = cols.reduce((sum, c) => sum + estimateColumnBytes(c), 0);
  const nullBitmapBytes = Math.ceil(cols.length / 8);
  const rowOverhead = 4 + nullBitmapBytes + variableCount * 2;
  const estimatedRowBytes = cols.length > 0 ? dataBytesPerRow + rowOverhead : 0;

  const rawRowBytes = table.rowCount * estimatedRowBytes;
  const indexCount = cols.filter((c) => c.primaryKey || c.unique).length;
  const indexRowFactor = indexCount > 0 ? 0.15 : 0;

  // SQL Server base page + index page allocation (8 KB data page + 4 KB per key/unique index)
  const basePageBytes = 8192 + indexCount * 4096;
  const sizeBytes = basePageBytes + Math.round(rawRowBytes * (1 + indexRowFactor));

  return { estimatedRowBytes, sizeBytes };
}

export function formatSizeMb(mb: number): string {
  if (mb <= 0) return '0.00 MB';
  if (mb < 1) return `${mb.toFixed(3)} MB`;
  if (mb < 100) return `${mb.toFixed(2)} MB`;
  return `${mb.toFixed(1)} MB`;
}

export function calculateDatabaseStats(tables: TableInfo[]): DatabaseStats {
  if (tables.length === 0) {
    return {
      tableCount: 0,
      populatedTableCount: 0,
      totalColumns: 0,
      totalRows: 0,
      totalSizeBytes: 0,
      totalSizeKb: 0,
      totalSizeMb: 0,
      avgRowsPerTable: 0,
      largestTable: null,
      perTable: [],
    };
  }

  let totalColumns = 0;
  let totalRows = 0;
  let totalSizeBytes = 0;
  let populatedTableCount = 0;

  const rawEntries = tables.map((table) => {
    const { estimatedRowBytes, sizeBytes } = estimateTableStorage(table);
    totalColumns += table.columns.length;
    totalRows += table.rowCount;
    totalSizeBytes += sizeBytes;
    if (table.rowCount > 0) populatedTableCount += 1;

    return {
      key: `${table.schema}.${table.name}`,
      schema: table.schema,
      name: table.name,
      rowCount: table.rowCount,
      columnCount: table.columns.length,
      estimatedRowBytes,
      sizeBytes,
      sizeMb: sizeBytes / (1024 * 1024),
    };
  });

  const perTable: TableStorageStat[] = rawEntries
    .map((entry) => ({
      ...entry,
      sharePercent: totalSizeBytes > 0 ? (entry.sizeBytes / totalSizeBytes) * 100 : 0,
    }))
    .sort((a, b) => b.sizeBytes - a.sizeBytes || b.rowCount - a.rowCount);

  return {
    tableCount: tables.length,
    populatedTableCount,
    totalColumns,
    totalRows,
    totalSizeBytes,
    totalSizeKb: totalSizeBytes / 1024,
    totalSizeMb: totalSizeBytes / (1024 * 1024),
    avgRowsPerTable: Math.round(totalRows / tables.length),
    largestTable: perTable[0] ?? null,
    perTable,
  };
}

interface DatabaseSummaryProps {
  tables: TableInfo[];
  databaseName?: string;
  serverName?: string;
  loading?: boolean;
  selectedTableKey?: string | 'new';
  onSelectTable?: (tableKey: string) => void;
}

export function DatabaseSummary({
  tables,
  databaseName,
  serverName,
  loading = false,
  selectedTableKey,
  onSelectTable,
}: DatabaseSummaryProps) {
  const [showBreakdown, setShowBreakdown] = useState(false);

  const stats = useMemo(() => calculateDatabaseStats(tables), [tables]);

  return (
    <section
      aria-label="Database summary"
      className="rounded-xl bg-white dark:bg-[#161F30] border border-[#E6EBF2] dark:border-[#243147] overflow-hidden"
    >
      {/* Header */}
      <div className="px-5 py-3.5 border-b border-[#E6EBF2] dark:border-[#243147] bg-[#FAFBFD] dark:bg-[#1D283B]/40 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-blue-50 dark:bg-blue-950/60 border border-blue-200/70 dark:border-blue-800/70 text-blue-600 dark:text-blue-400">
            <Database className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
              <h2 className="font-display text-sm font-semibold text-[#172033] dark:text-[#F1F5F9]">
                Database summary
              </h2>
              {databaseName && (
                <span className="font-mono text-xs text-slate-500 dark:text-slate-400 truncate">
                  {databaseName}
                  {serverName ? ` · ${serverName}` : ''}
                </span>
              )}
            </div>
            <p className="text-[11px] text-slate-500 dark:text-slate-400 tabular-nums">
              {loading
                ? 'Calculating row counts and storage footprint...'
                : stats.tableCount === 0
                ? 'No tables in this database yet — create one below to inspect statistics.'
                : `${stats.tableCount} ${stats.tableCount === 1 ? 'table' : 'tables'} · ${stats.totalColumns} columns · ${stats.populatedTableCount} populated`}
            </p>
          </div>
        </div>

        {!loading && stats.perTable.length > 0 && (
          <button
            type="button"
            onClick={() => setShowBreakdown((v) => !v)}
            aria-expanded={showBreakdown}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[#D8E1EC] dark:border-[#2C3A52] bg-white dark:bg-[#1D283B] text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-[#243147] transition-colors cursor-pointer whitespace-nowrap shrink-0"
          >
            {showBreakdown ? (
              <ChevronUp className="h-3.5 w-3.5 text-slate-400" />
            ) : (
              <ChevronDown className="h-3.5 w-3.5 text-slate-400" />
            )}
            <span>{showBreakdown ? 'Hide breakdown' : 'Table breakdown'}</span>
          </button>
        )}
      </div>

      {/* Stat Grid */}
      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 divide-y sm:divide-y-0 sm:divide-x divide-[#E6EBF2] dark:divide-[#243147]">
          {[0, 1, 2, 3].map((slot) => (
            <div key={slot} className="px-5 py-4 space-y-2.5 animate-pulse">
              <div className="h-3 w-24 rounded bg-slate-200/80 dark:bg-slate-700/60" />
              <div className="h-7 w-28 rounded bg-slate-200 dark:bg-slate-700" />
              <div className="h-3 w-32 rounded bg-slate-100 dark:bg-slate-800" />
            </div>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 divide-y sm:divide-y-0 sm:divide-x divide-[#E6EBF2] dark:divide-[#243147]">
          {/* Total Rows */}
          <div className="px-5 py-4 space-y-1">
            <div className="flex items-center gap-1.5 text-xs font-medium text-slate-500 dark:text-slate-400">
              <Rows3 className="h-3.5 w-3.5 text-slate-400 dark:text-slate-500" />
              <span>Total rows</span>
            </div>
            <div className="font-display text-2xl font-bold font-mono tabular-nums text-[#172033] dark:text-[#F1F5F9]">
              {stats.totalRows.toLocaleString()}
            </div>
            <p className="text-[11px] text-slate-500 dark:text-slate-400 tabular-nums">
              {stats.tableCount > 0
                ? `Avg ${stats.avgRowsPerTable.toLocaleString()} rows per table`
                : 'Waiting for table data'}
            </p>
          </div>

          {/* Estimated Size in MB */}
          <div className="px-5 py-4 space-y-1">
            <div className="flex items-center gap-1.5 text-xs font-medium text-slate-500 dark:text-slate-400">
              <HardDrive className="h-3.5 w-3.5 text-slate-400 dark:text-slate-500" />
              <span>Estimated size</span>
            </div>
            <div className="font-display text-2xl font-bold font-mono tabular-nums text-[#172033] dark:text-[#F1F5F9]">
              {formatSizeMb(stats.totalSizeMb)}
            </div>
            <p className="text-[11px] text-slate-500 dark:text-slate-400 tabular-nums">
              {stats.totalSizeKb.toFixed(1)} KB data &amp; index footprint
            </p>
          </div>

          {/* Tables & Columns */}
          <div className="px-5 py-4 space-y-1">
            <div className="flex items-center gap-1.5 text-xs font-medium text-slate-500 dark:text-slate-400">
              <Layers className="h-3.5 w-3.5 text-slate-400 dark:text-slate-500" />
              <span>Tables &amp; columns</span>
            </div>
            <div className="flex items-baseline gap-2">
              <span className="font-display text-2xl font-bold font-mono tabular-nums text-[#172033] dark:text-[#F1F5F9]">
                {stats.tableCount.toLocaleString()}
              </span>
              <span className="text-xs text-slate-500 dark:text-slate-400">
                {stats.tableCount === 1 ? 'table' : 'tables'}
              </span>
            </div>
            <p className="text-[11px] text-slate-500 dark:text-slate-400 tabular-nums">
              {stats.totalColumns.toLocaleString()} columns · {stats.populatedTableCount} populated
            </p>
          </div>

          {/* Largest Table */}
          <div className="px-5 py-4 space-y-1 min-w-0">
            <div className="flex items-center gap-1.5 text-xs font-medium text-slate-500 dark:text-slate-400">
              <Table2 className="h-3.5 w-3.5 text-slate-400 dark:text-slate-500" />
              <span>Largest table</span>
            </div>
            {stats.largestTable ? (
              <>
                <div className="pt-0.5 min-w-0">
                  {onSelectTable ? (
                    <button
                      type="button"
                      onClick={() => onSelectTable(stats.largestTable!.key)}
                      className="font-mono text-base font-bold text-blue-600 dark:text-blue-400 hover:underline truncate max-w-full block text-left cursor-pointer"
                      title={`Inspect ${stats.largestTable.key}`}
                    >
                      {stats.largestTable.key}
                    </button>
                  ) : (
                    <span className="font-mono text-base font-bold text-[#172033] dark:text-[#F1F5F9] truncate block">
                      {stats.largestTable.key}
                    </span>
                  )}
                </div>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 tabular-nums pt-0.5">
                  {stats.largestTable.rowCount.toLocaleString()} rows ·{' '}
                  {formatSizeMb(stats.largestTable.sizeMb)}
                </p>
              </>
            ) : (
              <>
                <div className="font-display text-2xl font-bold font-mono text-slate-400 dark:text-slate-500">
                  —
                </div>
                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                  No tables available
                </p>
              </>
            )}
          </div>
        </div>
      )}

      {/* Expandable Per-Table Storage Breakdown */}
      <AnimatePresence initial={false}>
        {showBreakdown && !loading && stats.perTable.length > 0 && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.18, ease: 'easeOut' }}
            className="overflow-hidden border-t border-[#E6EBF2] dark:border-[#243147]"
          >
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="bg-[#FAFBFD] dark:bg-[#1D283B]/50 border-b border-[#E6EBF2] dark:border-[#243147] text-[11px] font-semibold text-slate-500 dark:text-slate-400">
                    <th className="px-5 py-2.5 font-medium">Table</th>
                    <th className="px-4 py-2.5 font-medium text-right">Columns</th>
                    <th className="px-4 py-2.5 font-medium text-right">Rows</th>
                    <th className="px-4 py-2.5 font-medium text-right">Size (MB)</th>
                    <th className="px-5 py-2.5 font-medium w-44">Storage share</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#EEF2F7] dark:divide-[#243147]">
                  {stats.perTable.map((t) => {
                    const isSelected = selectedTableKey === t.key;
                    return (
                      <tr
                        key={t.key}
                        onClick={() => onSelectTable?.(t.key)}
                        className={`transition-colors ${
                          onSelectTable ? 'cursor-pointer' : ''
                        } ${
                          isSelected
                            ? 'bg-blue-50/70 dark:bg-blue-950/35'
                            : 'hover:bg-[#F8FAFC] dark:hover:bg-[#1D283B]/50'
                        }`}
                      >
                        <td className="px-5 py-2.5 font-mono font-medium text-[#172033] dark:text-[#E6ECF5] whitespace-nowrap">
                          {t.key}
                        </td>
                        <td className="px-4 py-2.5 text-right font-mono tabular-nums text-slate-600 dark:text-slate-300">
                          {t.columnCount}
                        </td>
                        <td className="px-4 py-2.5 text-right font-mono tabular-nums text-[#172033] dark:text-[#F1F5F9]">
                          {t.rowCount.toLocaleString()}
                        </td>
                        <td className="px-4 py-2.5 text-right font-mono tabular-nums text-[#172033] dark:text-[#F1F5F9]">
                          {formatSizeMb(t.sizeMb)}
                        </td>
                        <td className="px-5 py-2.5">
                          <div className="flex items-center gap-2.5">
                            <div className="h-1.5 flex-1 rounded-full bg-slate-100 dark:bg-[#1D283B] overflow-hidden">
                              <div
                                style={{ width: `${Math.max(4, Math.min(100, t.sharePercent))}%` }}
                                className="h-full rounded-full bg-blue-600 dark:bg-blue-400"
                              />
                            </div>
                            <span className="w-10 text-right font-mono text-[11px] tabular-nums text-slate-500 dark:text-slate-400">
                              {t.sharePercent.toFixed(0)}%
                            </span>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}
