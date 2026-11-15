import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Check,
  ChevronDown,
  ChevronRight,
  Columns3,
  Copy,
  Download,
  FileJson,
  FileSpreadsheet,
  FileText,
  KeyRound,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  Sparkles,
  Star,
  Table2,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import {
  api,
  EXPORT_FORMATS,
  exportData,
  sheetFromRecords,
  type ColumnDef,
  type ExportFormat,
  type ResultSet,
  type TableInfo,
} from '../lib/api';
import { favKey, favoritesApi } from '../lib/userData';
import { DatabaseSummary } from '../components/DatabaseSummary';
import { isEditableTarget } from '../components/ShortcutsModal';
import {
  DataGrid,
  DataGridSkeleton,
  errMsg,
  Field,
  inputClass,
  selectClass,
  SidebarListSkeleton,
} from '../components/shared';

const TYPES = [
  'int',
  'bigint',
  'smallint',
  'tinyint',
  'bit',
  'decimal',
  'float',
  'real',
  'money',
  'nvarchar',
  'varchar',
  'nchar',
  'char',
  'date',
  'datetime',
  'datetime2',
  'time',
  'uniqueidentifier',
  'varbinary',
];

const SIZE_HINT: Record<string, string> = {
  nvarchar: 'length or max',
  varchar: 'length or max',
  varbinary: 'length or max',
  nchar: 'length',
  char: 'length',
  decimal: 'p,s e.g. 18,2',
  datetime2: 'scale 0-7',
  time: 'scale 0-7',
};

const DEFAULT_SIZE: Record<string, string> = {
  nvarchar: '255',
  varchar: '255',
  varbinary: 'max',
  nchar: '10',
  char: '10',
  decimal: '18,2',
};

interface Draft {
  id: number;
  name: string;
  type: string;
  size: string;
  nullable: boolean;
  primaryKey: boolean;
  identity: boolean;
  unique: boolean;
  default: string;
  check: string;
  refTable: string;
  refColumn: string;
  showExtra?: boolean;
}

let nextId = 1;
const blank = (): Draft => ({
  id: nextId++,
  name: '',
  type: 'int',
  size: '',
  nullable: true,
  primaryKey: false,
  identity: false,
  unique: false,
  default: '',
  check: '',
  refTable: '',
  refColumn: '',
  showExtra: false,
});

const defaultDraftCols = (): Draft[] => [
  { ...blank(), name: 'Id', type: 'int', nullable: false, primaryKey: true, identity: true },
  { ...blank(), name: 'Name', type: 'nvarchar', size: '100', nullable: false },
];

function toDef(d: Draft): ColumnDef {
  const def: ColumnDef = {
    name: d.name,
    type: d.type,
    nullable: d.nullable,
    primaryKey: d.primaryKey,
    identity: d.identity,
    unique: d.unique,
    default: d.default.trim() || null,
    check: d.check.trim() || null,
  };
  const size = d.size.trim() || DEFAULT_SIZE[d.type] || '';
  if (['nvarchar', 'varchar', 'varbinary', 'nchar', 'char'].includes(d.type)) def.length = size;
  if (d.type === 'decimal') {
    const [p, s] = size.split(',');
    def.precision = Number(p) || 18;
    def.scale = Number(s ?? 2);
  }
  if (['datetime2', 'time'].includes(d.type) && size) def.scale = Number(size);
  if (d.refTable && d.refColumn) {
    const [schema, table] = d.refTable.split('.');
    def.references = { schema, table, column: d.refColumn };
  }
  return def;
}

function fromDef(c: ColumnDef): Draft {
  let size = c.length ?? '';
  if (c.type === 'decimal') size = `${c.precision ?? 18},${c.scale ?? 2}`;
  return {
    ...blank(),
    name: c.name,
    type: c.type,
    size,
    nullable: c.nullable,
    primaryKey: c.primaryKey,
    identity: c.identity,
    unique: c.unique,
  };
}

/** Accepts [..], {..} or {"anything": [..]} and returns the list of row objects. */
function parseRows(text: string): Record<string, unknown>[] {
  const v = JSON.parse(text);
  if (Array.isArray(v)) return v;
  if (v && typeof v === 'object') {
    const arrays = Object.values(v).filter(Array.isArray);
    if (arrays.length === 1) return arrays[0] as Record<string, unknown>[];
    return [v as Record<string, unknown>];
  }
  throw new Error('JSON must be an array of objects');
}

function readFile(file: File) {
  return new Promise<string>((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result));
    r.onerror = () => rej(r.error);
    r.readAsText(file);
  });
}

function sampleValueForType(type: string): unknown {
  const base = type.toLowerCase().replace(/\(.*\)/, '');
  if (['int', 'bigint', 'smallint', 'tinyint'].includes(base)) return 1;
  if (['decimal', 'numeric', 'float', 'real', 'money', 'smallmoney'].includes(base)) return 10.5;
  if (base === 'bit') return true;
  if (base === 'date') return '2026-01-15';
  if (['datetime', 'datetime2'].includes(base)) return '2026-01-15T10:30:00';
  if (base === 'time') return '10:30:00';
  if (base === 'uniqueidentifier') return '00000000-0000-0000-0000-000000000001';
  return 'Sample value';
}

const FORMAT_ICON = { json: FileJson, csv: FileText, xlsx: FileSpreadsheet } as const;
const FORMAT_TONE: Record<ExportFormat, string> = {
  json: 'bg-blue-50 text-blue-600 dark:bg-blue-950/50 dark:text-blue-400',
  csv: 'bg-teal-50 text-teal-600 dark:bg-teal-950/50 dark:text-teal-400',
  xlsx: 'bg-emerald-50 text-emerald-600 dark:bg-emerald-950/50 dark:text-emerald-400',
};

/** Dropdown that lets the user pick JSON, CSV or Excel before downloading. */
export function ExportMenu({
  label = 'Export',
  variant = 'secondary',
  disabled = false,
  tourId,
  onSelect,
}: {
  label?: string;
  variant?: 'primary' | 'secondary';
  disabled?: boolean;
  tourId?: string;
  onSelect: (format: ExportFormat) => void;
}) {
  const [open, setOpen] = useState(false);
  const [up, setUp] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  const toggle = (next: boolean) => {
    if (next && wrapRef.current) {
      const r = wrapRef.current.getBoundingClientRect();
      setUp(window.innerHeight - r.bottom < 220 && r.top > 220);
    }
    setOpen(next);
  };

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  // The onboarding tour opens this menu so newcomers can see the options.
  useEffect(() => {
    if (!tourId) return;
    const onTour = (e: Event) => {
      const d = (e as CustomEvent<{ id: string; open: boolean }>).detail;
      if (d && d.id === tourId) toggle(Boolean(d.open));
    };
    window.addEventListener('jp-tour-export-menu', onTour);
    return () => window.removeEventListener('jp-tour-export-menu', onTour);
  }, [tourId]);

  const btnClass =
    'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold cursor-pointer whitespace-nowrap transition-colors disabled:opacity-50 disabled:cursor-not-allowed ' +
    (variant === 'primary'
      ? 'bg-blue-600 hover:bg-blue-700 text-white'
      : 'border border-[#D8E1EC] dark:border-[#2C3A52] bg-white dark:bg-[#1D283B] text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-[#243147]');

  return (
    <div ref={wrapRef} data-tour={tourId} className="relative inline-block">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => toggle(!open)}
        className={btnClass}
      >
        <Download className="h-3.5 w-3.5" />
        <span>{label}</span>
        <ChevronDown className={'h-3.5 w-3.5 transition-transform ' + (open ? 'rotate-180' : '')} />
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            role="menu"
            initial={{ opacity: 0, y: up ? 6 : -6, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: up ? 6 : -6, scale: 0.97 }}
            transition={{ duration: 0.14, ease: 'easeOut' }}
            className={
              'absolute right-0 z-30 w-60 overflow-hidden rounded-xl border border-[#E6EBF2] dark:border-[#2C3A52] bg-white dark:bg-[#1D283B] shadow-lg ' +
              (up ? 'bottom-full mb-1.5' : 'top-full mt-1.5')
            }
          >
            <div className="px-3 pt-2.5 pb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
              Export as
            </div>
            {EXPORT_FORMATS.map((f) => {
              const Icon = FORMAT_ICON[f.id];
              return (
                <button
                  key={f.id}
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setOpen(false);
                    onSelect(f.id);
                  }}
                  className="w-full flex items-center gap-2.5 px-3 py-2 text-left cursor-pointer hover:bg-slate-50 dark:hover:bg-[#243147]"
                >
                  <span className={'flex h-7 w-7 shrink-0 items-center justify-center rounded-md ' + FORMAT_TONE[f.id]}>
                    <Icon className="h-3.5 w-3.5" />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-xs font-semibold text-[#172033] dark:text-[#F1F5F9]">{f.label}</span>
                    <span className="block text-[11px] text-slate-500 dark:text-slate-400">{f.hint}</span>
                  </span>
                </button>
              );
            })}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ---------------------------------------------------------------------------
function TableBuilder({
  tables,
  onCreated,
  onNotify,
}: {
  tables: TableInfo[];
  onCreated: (name: string) => void;
  onNotify: (msg: string, tone?: 'success' | 'error') => void;
}) {
  const [schema, setSchema] = useState('dbo');
  const [name, setName] = useState('');
  const [cols, setCols] = useState<Draft[]>(defaultDraftCols);
  const [pendingRows, setPendingRows] = useState<Record<string, unknown>[] | null>(null);
  const [sql, setSql] = useState('');
  const [sqlError, setSqlError] = useState('');
  const [copiedSql, setCopiedSql] = useState(false);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const update = (id: number, patch: Partial<Draft>) =>
    setCols((cs) => cs.map((c) => (c.id === id ? { ...c, ...patch } : c)));

  const payload = useMemo(
    () => ({ schema, name, columns: cols.map(toDef) }),
    [schema, name, cols]
  );

  useEffect(() => {
    if (!name.trim()) {
      setSql('');
      setSqlError('');
      return;
    }
    const h = setTimeout(async () => {
      try {
        setSql((await api.previewTable(payload)).sql);
        setSqlError('');
      } catch (e) {
        setSql('');
        setSqlError(errMsg(e));
      }
    }, 300);
    return () => clearTimeout(h);
  }, [payload, name]);

  const fromJsonFile = async (file: File) => {
    try {
      const rows = parseRows(await readFile(file));
      const inferred = await api.infer(rows);
      setCols(inferred.map(fromDef));
      setPendingRows(rows);
      if (!name.trim()) setName(file.name.replace(/\.[^.]+$/, '').replace(/[^\w ]/g, '_'));
      onNotify(
        `Inferred ${inferred.length} columns from ${rows.length} rows — review them below`,
        'success'
      );
    } catch (e) {
      onNotify(errMsg(e), 'error');
    }
  };

  const resetBuilder = () => {
    setSchema('dbo');
    setName('');
    setCols(defaultDraftCols());
    setPendingRows(null);
    setSql('');
    setSqlError('');
  };

  const copySql = async () => {
    if (!sql) return;
    await navigator.clipboard?.writeText(sql).catch(() => {});
    setCopiedSql(true);
    setTimeout(() => setCopiedSql(false), 1800);
  };

  const create = async () => {
    setBusy(true);
    try {
      await api.createTable(payload);
      let msg = `Table ${schema}.${name} created`;
      if (pendingRows?.length) {
        try {
          const r = await api.importRows(schema, name, pendingRows);
          msg += ` and ${r.inserted} rows imported`;
        } catch (e) {
          onNotify(`Table created, but import failed: ${errMsg(e)}`, 'error');
        }
      }
      onNotify(msg, 'success');
      onCreated(`${schema}.${name}`);
    } catch (e) {
      onNotify(errMsg(e), 'error');
    } finally {
      setBusy(false);
    }
  };

  const refCols = (t: string) =>
    tables.find((x) => `${x.schema}.${x.name}` === t)?.columns ?? [];

  const createRef = useRef({ create: () => {}, enabled: false });
  createRef.current = {
    create: () => void create(),
    enabled: !busy && !sqlError && Boolean(sql),
  };

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (document.querySelector('[role="dialog"]')) return;
      if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key === 'Enter') {
        if (createRef.current.enabled) {
          e.preventDefault();
          createRef.current.create();
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  return (
    <section className="rounded-xl bg-white dark:bg-[#161F30] border border-[#E6EBF2] dark:border-[#243147] overflow-hidden">
      {/* Header */}
      <div className="px-6 py-4 border-b border-[#E6EBF2] dark:border-[#243147] flex flex-wrap items-center justify-between gap-3 bg-[#FAFBFD] dark:bg-[#1D283B]/40">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-blue-50 dark:bg-blue-950/60 border border-blue-200/70 dark:border-blue-800/70 text-blue-600 dark:text-blue-400">
            <Table2 className="h-4 w-4" />
          </div>
          <div>
            <h2 className="font-display text-base font-semibold text-[#172033] dark:text-[#F1F5F9]">
              Create table
            </h2>
            <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
              Define columns and constraints manually or infer schema from a JSON file.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <input
            ref={fileRef}
            type="file"
            accept=".json,application/json"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void fromJsonFile(f);
              e.target.value = '';
            }}
          />
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-[#D8E1EC] dark:border-[#2C3A52] bg-white dark:bg-[#1D283B] text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-[#243147] transition-colors cursor-pointer whitespace-nowrap"
          >
            <FileJson className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400" />
            <span>Infer from JSON file</span>
          </button>
        </div>
      </div>

      <div className="p-6 space-y-6">
        {/* Table Identity */}
        <div className="rounded-xl border border-[#E6EBF2] dark:border-[#243147] bg-[#FAFBFD] dark:bg-[#111927]/50 p-4 space-y-3">
          <div className="grid gap-3.5 sm:grid-cols-[140px_1fr] items-end">
            <Field label="Schema">
              <input
                value={schema}
                onChange={(e) => setSchema(e.target.value)}
                className={`${inputClass} font-mono bg-white dark:bg-[#161F30]`}
              />
            </Field>
            <Field label="Table name">
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Customers"
                className={`${inputClass} font-mono bg-white dark:bg-[#161F30]`}
              />
            </Field>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 pt-2.5 border-t border-[#E6EBF2] dark:border-[#243147] text-xs">
            <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
              Target object
            </span>
            <span className="font-mono font-semibold text-blue-700 dark:text-blue-300 break-all">
              [{schema || 'dbo'}].[{name.trim() || 'TableName'}]
            </span>
          </div>
        </div>

        {pendingRows && (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-blue-200 dark:border-blue-900/60 bg-blue-50 dark:bg-blue-950/35 px-4 py-3 text-xs text-blue-900 dark:text-blue-200">
            <span className="tabular-nums font-medium">
              {pendingRows.length} rows from the JSON file will be imported immediately after creation.
            </span>
            <button
              type="button"
              onClick={() => setPendingRows(null)}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md border border-blue-300/70 dark:border-blue-800 bg-white/70 dark:bg-[#161F30] font-medium text-blue-700 dark:text-blue-300 hover:bg-white cursor-pointer"
            >
              <X className="h-3.5 w-3.5" />
              <span>Don&apos;t import</span>
            </button>
          </div>
        )}

        {/* Columns Designer */}
        <div className="space-y-3">
          <div>
            <h3 className="font-display text-sm font-semibold text-[#172033] dark:text-[#F1F5F9]">
              Columns ({cols.length})
            </h3>
            <p className="text-[11px] text-slate-500 dark:text-slate-400">
              Configure types, primary keys, defaults, and foreign key references.
            </p>
          </div>

          <div className="rounded-xl border border-[#E6EBF2] dark:border-[#243147] overflow-hidden">
            {/* Desktop Column Header */}
            <div className="hidden sm:grid sm:grid-cols-[28px_1fr_140px_130px_172px] gap-2.5 px-4 py-2.5 bg-[#FAFBFD] dark:bg-[#1D283B]/70 border-b border-[#E6EBF2] dark:border-[#243147] text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider items-center">
              <span className="text-center">#</span>
              <span>Column name</span>
              <span>Data type</span>
              <span>Size / precision</span>
              <span className="text-right">Actions</span>
            </div>

            <div className="divide-y divide-[#E6EBF2] dark:divide-[#243147]">
              {cols.map((c, idx) => {
                const hasExtra = Boolean(c.default || c.check || c.refTable);
                const showExtra = Boolean(c.showExtra || hasExtra);
                return (
                  <div
                    key={c.id}
                    className={`p-4 space-y-3 transition-colors ${
                      c.primaryKey
                        ? 'bg-blue-50/25 dark:bg-blue-950/15'
                        : 'bg-white dark:bg-[#161F30]'
                    }`}
                  >
                    <div className="grid gap-2.5 sm:grid-cols-[28px_1fr_140px_130px_172px] items-center">
                      <span className="hidden sm:inline-flex items-center justify-center text-[11px] font-mono font-semibold text-slate-400 tabular-nums">
                        {String(idx + 1).padStart(2, '0')}
                      </span>
                      <input
                        placeholder="Column name"
                        value={c.name}
                        onChange={(e) => update(c.id, { name: e.target.value })}
                        className={`${inputClass} font-mono text-xs py-1.5 bg-white dark:bg-[#1D283B]`}
                      />
                      <select
                        value={c.type}
                        onChange={(e) => update(c.id, { type: e.target.value, size: '' })}
                        className={`${selectClass} font-mono text-xs py-1.5 bg-white dark:bg-[#1D283B]`}
                      >
                        {TYPES.map((t) => (
                          <option key={t}>{t}</option>
                        ))}
                      </select>
                      <input
                        placeholder={SIZE_HINT[c.type] ?? 'size n/a'}
                        disabled={!SIZE_HINT[c.type]}
                        value={c.size}
                        onChange={(e) => update(c.id, { size: e.target.value })}
                        className={`${inputClass} font-mono text-xs py-1.5 bg-white dark:bg-[#1D283B]`}
                      />
                      <div className="flex items-center justify-end gap-1.5">
                        <button
                          type="button"
                          onClick={() => update(c.id, { showExtra: !showExtra })}
                          title="Default, Check & Foreign key options"
                          className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md border text-[11px] font-medium transition-colors cursor-pointer whitespace-nowrap ${
                            showExtra || hasExtra
                              ? 'border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300'
                              : 'border-[#D8E1EC] dark:border-[#2C3A52] text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-[#1D283B]'
                          }`}
                        >
                          {showExtra ? (
                            <ChevronDown className="h-3.5 w-3.5" />
                          ) : (
                            <ChevronRight className="h-3.5 w-3.5" />
                          )}
                          <span>Options</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => setCols((cs) => cs.filter((x) => x.id !== c.id))}
                          title="Delete column"
                          aria-label="Delete column"
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md border border-rose-200 dark:border-rose-900/60 bg-rose-50/70 dark:bg-rose-950/30 text-[11px] font-medium text-rose-600 dark:text-rose-400 hover:bg-rose-100 dark:hover:bg-rose-950/60 transition-colors cursor-pointer whitespace-nowrap"
                        >
                          <Trash2 className="h-3.5 w-3.5 text-rose-600 dark:text-rose-400" />
                          <span>Delete</span>
                        </button>
                      </div>
                    </div>

                    {/* Constraint Toggles */}
                    <div className="flex flex-wrap items-center gap-x-5 gap-y-2 rounded-lg bg-[#F8FAFC] dark:bg-[#111927]/70 px-3 py-2 text-xs text-slate-600 dark:text-slate-300 sm:ml-[38px]">
                      <label className="inline-flex items-center gap-1.5 cursor-pointer font-medium">
                        <input
                          type="checkbox"
                          checked={c.primaryKey}
                          onChange={(e) => update(c.id, { primaryKey: e.target.checked })}
                          className="rounded border-slate-300 text-blue-600"
                        />
                        {c.primaryKey && <KeyRound className="h-3 w-3 text-blue-600 dark:text-blue-400" />}
                        <span>Primary key</span>
                      </label>
                      <label className="inline-flex items-center gap-1.5 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={c.identity}
                          onChange={(e) => update(c.id, { identity: e.target.checked })}
                          className="rounded border-slate-300 text-blue-600"
                        />
                        <span>Identity</span>
                      </label>
                      <label className="inline-flex items-center gap-1.5 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={c.nullable && !c.primaryKey && !c.identity}
                          disabled={c.primaryKey || c.identity}
                          onChange={(e) => update(c.id, { nullable: e.target.checked })}
                          className="rounded border-slate-300 text-blue-600"
                        />
                        <span>Allow NULL</span>
                      </label>
                      <label className="inline-flex items-center gap-1.5 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={c.unique}
                          onChange={(e) => update(c.id, { unique: e.target.checked })}
                          className="rounded border-slate-300 text-blue-600"
                        />
                        <span>Unique</span>
                      </label>
                    </div>

                    <AnimatePresence initial={false}>
                      {showExtra && (
                        <motion.div
                          initial={{ opacity: 0, height: 0 }}
                          animate={{ opacity: 1, height: 'auto' }}
                          exit={{ opacity: 0, height: 0 }}
                          transition={{ duration: 0.18, ease: 'easeOut' }}
                          className="overflow-hidden"
                        >
                          <div className="grid gap-3 sm:grid-cols-4 rounded-lg border border-[#E6EBF2] dark:border-[#243147] bg-[#FAFBFD] dark:bg-[#111927]/60 p-3 sm:ml-[38px]">
                            <Field label="Default expression">
                              <input
                                placeholder="e.g. 0, GETDATE()"
                                value={c.default}
                                onChange={(e) => update(c.id, { default: e.target.value })}
                                className={`${inputClass} font-mono text-xs py-1.5 bg-white dark:bg-[#1D283B]`}
                              />
                            </Field>
                            <Field label="Check constraint">
                              <input
                                placeholder="e.g. Age >= 0"
                                value={c.check}
                                onChange={(e) => update(c.id, { check: e.target.value })}
                                className={`${inputClass} font-mono text-xs py-1.5 bg-white dark:bg-[#1D283B]`}
                              />
                            </Field>
                            <Field label="Foreign key table">
                              <select
                                value={c.refTable}
                                onChange={(e) => update(c.id, { refTable: e.target.value, refColumn: '' })}
                                className={`${selectClass} text-xs py-1.5 bg-white dark:bg-[#1D283B]`}
                              >
                                <option value="">None</option>
                                {tables.map((t) => (
                                  <option key={`${t.schema}.${t.name}`} value={`${t.schema}.${t.name}`}>
                                    {t.schema}.{t.name}
                                  </option>
                                ))}
                              </select>
                            </Field>
                            <Field label="Foreign key column">
                              <select
                                value={c.refColumn}
                                disabled={!c.refTable}
                                onChange={(e) => update(c.id, { refColumn: e.target.value })}
                                className={`${selectClass} text-xs py-1.5 bg-white dark:bg-[#1D283B]`}
                              >
                                <option value="">Select column...</option>
                                {refCols(c.refTable).map((rc) => (
                                  <option key={rc.name}>{rc.name}</option>
                                ))}
                              </select>
                            </Field>
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                );
              })}
            </div>

            {/* Bottom Add Column Bar */}
            <div className="px-4 py-3 bg-[#FAFBFD] dark:bg-[#1D283B]/50 border-t border-[#E6EBF2] dark:border-[#243147] flex items-center justify-between gap-3">
              <span className="text-[11px] text-slate-500 dark:text-slate-400 tabular-nums">
                {cols.length} {cols.length === 1 ? 'column' : 'columns'} defined
              </span>
              <button
                type="button"
                onClick={() => setCols((cs) => [...cs, blank()])}
                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/50 text-xs font-semibold text-blue-700 dark:text-blue-300 hover:bg-blue-100 dark:hover:bg-blue-950 transition-colors cursor-pointer whitespace-nowrap"
              >
                <Plus className="h-3.5 w-3.5" />
                <span>Add column</span>
              </button>
            </div>
          </div>
        </div>

        {/* Live SQL Preview */}
        <div className="rounded-xl border border-[#E2E8F0] dark:border-[#243147] overflow-hidden">
          <div className="px-4 py-2.5 bg-[#FAFBFD] dark:bg-[#1D283B]/70 border-b border-[#E2E8F0] dark:border-[#243147] flex items-center justify-between gap-2">
            <span className="text-xs font-semibold text-slate-600 dark:text-slate-300">
              T-SQL preview
            </span>
            {sql && !sqlError && (
              <button
                type="button"
                onClick={copySql}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md border border-[#D8E1EC] dark:border-[#2C3A52] bg-white dark:bg-[#161F30] text-[11px] font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-[#1D283B] cursor-pointer"
              >
                {copiedSql ? (
                  <Check className="h-3 w-3 text-emerald-600" />
                ) : (
                  <Copy className="h-3 w-3 text-slate-400" />
                )}
                <span>{copiedSql ? 'Copied' : 'Copy SQL'}</span>
              </button>
            )}
          </div>
          {sqlError ? (
            <p className="p-4 text-xs text-rose-600 dark:text-rose-400 bg-rose-50/40 dark:bg-rose-950/20">
              {sqlError}
            </p>
          ) : (
            <pre className="overflow-auto bg-[#F8FAFC] dark:bg-[#111927] p-4 font-mono text-xs leading-relaxed text-[#172033] dark:text-[#E6ECF5]">
              {sql || '-- Enter a table name above to preview the CREATE TABLE statement'}
            </pre>
          )}
        </div>

        {/* Bottom Actions */}
        <div className="pt-2 border-t border-[#E6EBF2] dark:border-[#243147] flex flex-wrap items-center justify-between gap-3">
          <button
            type="button"
            onClick={resetBuilder}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-[#D8E1EC] dark:border-[#2C3A52] text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-[#1D283B] transition-colors cursor-pointer"
          >
            <RotateCcw className="h-3.5 w-3.5 text-slate-400" />
            <span>Reset form</span>
          </button>

          <button
            type="button"
            onClick={create}
            disabled={busy || !!sqlError || !sql}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-xs font-semibold text-white transition-colors cursor-pointer disabled:opacity-50"
          >
            <Plus className="h-3.5 w-3.5" />
            <span>Create table{pendingRows ? ' & import rows' : ''}</span>
          </button>
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
function TableDetail({
  table,
  onChanged,
  onNotify,
}: {
  table: TableInfo;
  onChanged: () => void;
  onNotify: (msg: string, tone?: 'success' | 'error') => void;
}) {
  const [detailTab, setDetailTab] = useState<'data' | 'addRow' | 'importJson' | 'columns'>('data');
  const [rows, setRows] = useState<ResultSet | null>(null);
  const [loadingRows, setLoadingRows] = useState(true);
  const [selectedIndices, setSelectedIndices] = useState<Set<number>>(() => new Set());
  const [exporting, setExporting] = useState(false);
  const [values, setValues] = useState<Record<string, string>>({});
  const [jsonText, setJsonText] = useState('');
  const [dragActive, setDragActive] = useState(false);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const loadRows = useCallback(async () => {
    setLoadingRows(true);
    setSelectedIndices(new Set());
    try {
      setRows(await api.rows(table.schema, table.name, 100));
    } catch (e) {
      onNotify(errMsg(e), 'error');
    } finally {
      setLoadingRows(false);
    }
  }, [table.schema, table.name, onNotify]);

  useEffect(() => {
    setValues({});
    setJsonText('');
    setSelectedIndices(new Set());
    void loadRows();
  }, [loadRows]);

  const writable = useMemo(
    () => table.columns.filter((c) => !c.identity && !c.computed),
    [table.columns]
  );

  const jsonValidation = useMemo(() => {
    const trimmed = jsonText.trim();
    if (!trimmed) return null;
    try {
      const parsed = parseRows(trimmed);
      return { ok: true as const, count: parsed.length };
    } catch (e) {
      return { ok: false as const, message: errMsg(e) };
    }
  }, [jsonText]);

  const addRow = async () => {
    setBusy(true);
    try {
      const body: Record<string, unknown> = {};
      for (const c of writable) {
        const v = values[c.name];
        if (v === undefined || v === '') continue;
        body[c.name] = v.toLowerCase() === 'null' ? null : v;
      }
      await api.insertRow(table.schema, table.name, body);
      onNotify('Row added', 'success');
      setValues({});
      await loadRows();
      onChanged();
      setDetailTab('data');
    } catch (e) {
      onNotify(errMsg(e), 'error');
    } finally {
      setBusy(false);
    }
  };

  const loadSampleJson = () => {
    const sampleRow: Record<string, unknown> = {};
    for (const c of writable) {
      sampleRow[c.name] = sampleValueForType(c.type);
    }
    setJsonText(JSON.stringify([sampleRow], null, 2));
  };

  const importJson = async (text: string) => {
    setBusy(true);
    try {
      const r = await api.importRows(table.schema, table.name, parseRows(text));
      onNotify(`${r.inserted} rows imported`, 'success');
      setJsonText('');
      await loadRows();
      onChanged();
      setDetailTab('data');
    } catch (e) {
      onNotify(errMsg(e), 'error');
    } finally {
      setBusy(false);
    }
  };

  const exportRecords = (records: Record<string, unknown>[], baseName: string, format: ExportFormat) =>
    exportData({
      format,
      baseName,
      sheets: [
        sheetFromRecords(
          table.name,
          records,
          rows?.columns?.length ? rows.columns : table.columns.map((c) => c.name)
        ),
      ],
      json: records,
    });

  const toggleRowSelection = (index: number) => {
    setSelectedIndices((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  };

  const toggleAllRows = () => {
    if (!rows) return;
    setSelectedIndices((prev) => {
      if (prev.size === rows.rows.length) return new Set();
      return new Set(rows.rows.map((_, i) => i));
    });
  };

  const exportSelectedRows = (format: ExportFormat = 'json') => {
    if (!rows || selectedIndices.size === 0) return;
    const selectedRows = rows.rows.filter((_, idx) => selectedIndices.has(idx));
    try {
      const file = exportRecords(selectedRows, table.schema + '.' + table.name + '.selected', format);
      onNotify(
        'Exported ' + selectedRows.length + (selectedRows.length === 1 ? ' selected row' : ' selected rows') + ' to ' + file,
        'success'
      );
    } catch (e) {
      onNotify(errMsg(e), 'error');
    }
  };

  const exportEntireTable = async (format: ExportFormat = 'json') => {
    setExporting(true);
    try {
      let allRows = rows?.rows ?? [];
      if (!rows || table.rowCount > rows.rows.length) {
        const fullSet = await api.rows(table.schema, table.name, Math.max(table.rowCount, 10000));
        allRows = fullSet.rows;
      }
      const file = exportRecords(allRows, table.schema + '.' + table.name, format);
      onNotify('Exported entire table (' + allRows.length + (allRows.length === 1 ? ' row' : ' rows') + ') to ' + file, 'success');
    } catch (e) {
      onNotify(errMsg(e), 'error');
    } finally {
      setExporting(false);
    }
  };

  const detailShortcutRef = useRef({
    addRow: () => {},
    canAddRow: false,
    exportAction: () => {},
    canExport: false,
  });

  detailShortcutRef.current = {
    addRow: () => void addRow(),
    canAddRow: detailTab === 'addRow' && !busy && writable.length > 0,
    exportAction: () => {
      if (selectedIndices.size > 0) exportSelectedRows();
      else void exportEntireTable();
    },
    canExport: Boolean(rows && (rows.rows.length > 0 || table.rowCount > 0) && !exporting),
  };

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (document.querySelector('[role="dialog"]')) return;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && !e.altKey && e.key === 'Enter') {
        if (detailShortcutRef.current.canAddRow) {
          e.preventDefault();
          detailShortcutRef.current.addRow();
        }
        return;
      }
      if (e.altKey && !mod && !e.shiftKey && e.key.toLowerCase() === 'e') {
        if (detailShortcutRef.current.canExport) {
          e.preventDefault();
          detailShortcutRef.current.exportAction();
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  return (
    <section className="rounded-xl bg-white dark:bg-[#161F30] border border-[#E6EBF2] dark:border-[#243147] overflow-hidden min-w-0">
      {/* Header */}
      <div className="px-5 py-4 border-b border-[#E6EBF2] dark:border-[#243147] flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-base font-bold font-mono text-[#172033] dark:text-[#F1F5F9]">
            {table.schema}.{table.name}
          </h2>
          <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400 tabular-nums">
            {table.rowCount} rows · {table.columns.length} columns
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={loadRows}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[#D8E1EC] dark:border-[#2C3A52] text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-[#1D283B] cursor-pointer"
          >
            <RefreshCw className={`h-3.5 w-3.5 text-slate-400 ${loadingRows ? 'animate-spin' : ''}`} />
            <span>Refresh</span>
          </button>
          {rows && selectedIndices.size > 0 && (
            <ExportMenu
              label={'Export selected (' + selectedIndices.size + ')'}
              variant="primary"
              onSelect={(format) => exportSelectedRows(format)}
            />
          )}
          {rows && (
            <ExportMenu
              tourId="table-export"
              label={exporting ? 'Exporting...' : 'Export table'}
              variant={selectedIndices.size > 0 ? 'secondary' : 'primary'}
              disabled={exporting || (table.rowCount === 0 && rows.rows.length === 0)}
              onSelect={(format) => void exportEntireTable(format)}
            />
          )}
        </div>
      </div>

      {/* Sub-Tabs */}
      <div className="px-5 py-2.5 border-b border-[#E6EBF2] dark:border-[#243147] bg-[#FAFBFD] dark:bg-[#1D283B]/50 overflow-x-auto">
        <div className="inline-flex items-center gap-1 p-1 rounded-lg bg-[#EEF2F7] dark:bg-[#161F30]">
          <button
            type="button"
            onClick={() => setDetailTab('data')}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors cursor-pointer whitespace-nowrap ${
              detailTab === 'data'
                ? 'bg-white dark:bg-[#1D283B] text-[#172033] dark:text-white shadow-xs'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            <Table2 className="h-3.5 w-3.5" />
            <span>Data (first 100)</span>
          </button>
          <button
            type="button"
            onClick={() => setDetailTab('addRow')}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors cursor-pointer whitespace-nowrap ${
              detailTab === 'addRow'
                ? 'bg-white dark:bg-[#1D283B] text-[#172033] dark:text-white shadow-xs'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            <Plus className="h-3.5 w-3.5" />
            <span>Add Row</span>
          </button>
          <button
            type="button"
            onClick={() => setDetailTab('importJson')}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors cursor-pointer whitespace-nowrap ${
              detailTab === 'importJson'
                ? 'bg-white dark:bg-[#1D283B] text-[#172033] dark:text-white shadow-xs'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            <FileJson className="h-3.5 w-3.5" />
            <span>Import JSON</span>
          </button>
          <button
            type="button"
            onClick={() => setDetailTab('columns')}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors cursor-pointer whitespace-nowrap ${
              detailTab === 'columns'
                ? 'bg-white dark:bg-[#1D283B] text-[#172033] dark:text-white shadow-xs'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            <Columns3 className="h-3.5 w-3.5" />
            <span>Columns ({table.columns.length})</span>
          </button>
        </div>
      </div>

      {/* Tab Content */}
      <div className="p-5 sm:p-6">
        <AnimatePresence mode="wait">
          <motion.div
            key={detailTab}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.15, ease: 'easeOut' }}
          >
            {detailTab === 'data' &&
              (loadingRows ? (
                <DataGridSkeleton
                  columns={Math.max(3, Math.min(table.columns.length || 4, 6))}
                  rows={5}
                />
              ) : rows ? (
                <div className="space-y-3">
                  {rows.rows.length > 0 && (
                    <div className="flex flex-wrap items-center justify-between gap-2.5 rounded-xl border border-[#E6EBF2] dark:border-[#243147] bg-[#FAFBFD] dark:bg-[#111927]/50 px-3.5 py-2.5 text-xs">
                      <div className="flex flex-wrap items-center gap-2.5">
                        <span className="tabular-nums font-medium text-[#172033] dark:text-[#E6ECF5]">
                          {selectedIndices.size > 0
                            ? `${selectedIndices.size} of ${rows.rows.length} rows selected`
                            : `${rows.rows.length} of ${table.rowCount} rows shown`}
                        </span>
                        <span className="text-slate-300 dark:text-slate-600" aria-hidden="true">
                          ·
                        </span>
                        <button
                          type="button"
                          onClick={toggleAllRows}
                          className="font-medium text-blue-600 dark:text-blue-400 hover:underline cursor-pointer"
                        >
                          {selectedIndices.size === rows.rows.length
                            ? 'Deselect all'
                            : `Select all (${rows.rows.length})`}
                        </button>
                        {selectedIndices.size > 0 && selectedIndices.size < rows.rows.length && (
                          <button
                            type="button"
                            onClick={() => setSelectedIndices(new Set())}
                            className="font-medium text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 cursor-pointer"
                          >
                            Clear
                          </button>
                        )}
                      </div>

                      <div className="flex flex-wrap items-center gap-2">
                        <ExportMenu
                          label={'Export selected (' + selectedIndices.size + ')'}
                          variant="secondary"
                          disabled={selectedIndices.size === 0}
                          onSelect={(format) => exportSelectedRows(format)}
                        />
                        <ExportMenu
                          label={exporting ? 'Exporting...' : 'Export entire table (' + table.rowCount + ')'}
                          variant="primary"
                          disabled={exporting}
                          onSelect={(format) => void exportEntireTable(format)}
                        />
                      </div>
                    </div>
                  )}

                  <DataGrid
                    set={rows}
                    maxHeight={460}
                    selectable
                    selectedIndices={selectedIndices}
                    onToggleRow={toggleRowSelection}
                    onToggleAll={toggleAllRows}
                  />
                </div>
              ) : null)}

        {/* Separated Add Row Tab */}
        {detailTab === 'addRow' && (
          <div className="space-y-5">
            <div className="rounded-xl border border-[#E6EBF2] dark:border-[#243147] bg-[#FAFBFD] dark:bg-[#111927]/50 px-4 py-3.5 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="font-display text-sm font-semibold text-[#172033] dark:text-[#F1F5F9]">
                  Insert a single row
                </h3>
                <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                  Leave optional fields blank for defaults or NULL. Identity columns auto-increment.
                </p>
              </div>
              <span className="text-[11px] font-mono text-slate-500 dark:text-slate-400 tabular-nums">
                {writable.length} writable {writable.length === 1 ? 'column' : 'columns'}
              </span>
            </div>

            {writable.length === 0 ? (
              <div className="rounded-xl border border-dashed border-[#D8E1EC] dark:border-[#2C3A52] p-8 text-center text-xs text-slate-500 dark:text-slate-400">
                All columns in this table are identity or computed columns.
              </div>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2">
                {writable.map((c) => (
                  <div
                    key={c.name}
                    className="rounded-xl border border-[#E6EBF2] dark:border-[#243147] bg-white dark:bg-[#1D283B]/45 p-3.5 space-y-2"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <label
                        htmlFor={`add-row-${c.name}`}
                        className="font-mono text-xs font-semibold text-[#172033] dark:text-[#F1F5F9] truncate"
                      >
                        {c.name}
                      </label>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <span className="font-mono text-[11px] px-1.5 py-0.5 rounded bg-slate-100 dark:bg-[#161F30] text-blue-700 dark:text-blue-300">
                          {c.type}
                        </span>
                        {!c.nullable && (
                          <span className="text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded bg-amber-50 dark:bg-amber-950/50 text-amber-700 dark:text-amber-300">
                            Required
                          </span>
                        )}
                      </div>
                    </div>
                    <input
                      id={`add-row-${c.name}`}
                      value={values[c.name] ?? ''}
                      onChange={(e) =>
                        setValues((v) => ({ ...v, [c.name]: e.target.value }))
                      }
                      placeholder={
                        c.default
                          ? `Default: ${c.default}`
                          : c.nullable
                          ? 'Optional (leave blank or type null)'
                          : `Enter ${c.type} value`
                      }
                      className={`${inputClass} font-mono text-xs bg-[#FAFBFD] dark:bg-[#161F30]`}
                    />
                  </div>
                ))}
              </div>
            )}

            <div className="pt-3 border-t border-[#E6EBF2] dark:border-[#243147] flex flex-wrap items-center justify-between gap-3">
              <button
                type="button"
                onClick={() => setValues({})}
                disabled={busy || Object.keys(values).length === 0}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-[#D8E1EC] dark:border-[#2C3A52] text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-[#1D283B] cursor-pointer disabled:opacity-50"
              >
                <RotateCcw className="h-3.5 w-3.5 text-slate-400" />
                <span>Clear fields</span>
              </button>

              <button
                type="button"
                onClick={addRow}
                disabled={busy || writable.length === 0}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-xs font-semibold text-white cursor-pointer disabled:opacity-50"
              >
                <Plus className="h-3.5 w-3.5" />
                <span>Insert row</span>
              </button>
            </div>
          </div>
        )}

        {/* Separated Import JSON Tab */}
        {detailTab === 'importJson' && (
          <div className="space-y-5">
            <div className="rounded-xl border border-[#E6EBF2] dark:border-[#243147] bg-[#FAFBFD] dark:bg-[#111927]/50 p-4 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="font-display text-sm font-semibold text-[#172033] dark:text-[#F1F5F9]">
                  Bulk import from JSON
                </h3>
                <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                  Provide an array of objects whose keys match table columns. Runs as an all-or-nothing import.
                </p>
              </div>
              <button
                type="button"
                onClick={loadSampleJson}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[#D8E1EC] dark:border-[#2C3A52] bg-white dark:bg-[#161F30] text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-[#1D283B] cursor-pointer whitespace-nowrap"
              >
                <Sparkles className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400" />
                <span>Load sample JSON</span>
              </button>
            </div>

            {writable.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5 text-xs">
                <span className="text-slate-500 dark:text-slate-400 mr-1">Expected keys:</span>
                {writable.map((c) => (
                  <span
                    key={c.name}
                    className="inline-flex items-center gap-1 rounded-md border border-[#E6EBF2] dark:border-[#243147] bg-[#F8FAFC] dark:bg-[#1D283B] px-2 py-0.5 font-mono text-[11px] text-[#172033] dark:text-[#E6ECF5]"
                  >
                    <span>{c.name}</span>
                    <span className="text-slate-400">({c.type})</span>
                  </span>
                ))}
              </div>
            )}

            {/* Dropzone + File Picker */}
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setDragActive(true);
              }}
              onDragLeave={() => setDragActive(false)}
              onDrop={async (e) => {
                e.preventDefault();
                setDragActive(false);
                const f = e.dataTransfer.files?.[0];
                if (f) setJsonText(await readFile(f));
              }}
              className={`rounded-xl border border-dashed p-4 transition-colors flex flex-wrap items-center justify-between gap-3 ${
                dragActive
                  ? 'border-blue-500 bg-blue-50/70 dark:bg-blue-950/30'
                  : 'border-[#CBD5E1] dark:border-[#2C3A52] bg-[#FAFBFD] dark:bg-[#111927]/40'
              }`}
            >
              <div className="flex items-center gap-3 min-w-0">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white dark:bg-[#1D283B] border border-[#E2E8F0] dark:border-[#2C3A52] text-blue-600 dark:text-blue-400">
                  <FileJson className="h-4 w-4" />
                </div>
                <div className="min-w-0">
                  <div className="text-xs font-medium text-[#172033] dark:text-[#E6ECF5]">
                    Drop a <code className="font-mono">.json</code> file here or choose from disk
                  </div>
                  <div className="text-[11px] text-slate-500 dark:text-slate-400">
                    Accepts <code className="font-mono">[...]</code> arrays or wrapped row arrays.
                  </div>
                </div>
              </div>

              <div>
                <input
                  ref={fileRef}
                  type="file"
                  accept=".json,application/json"
                  className="hidden"
                  onChange={async (e) => {
                    const f = e.target.files?.[0];
                    if (f) setJsonText(await readFile(f));
                    e.target.value = '';
                  }}
                />
                <button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-[#D8E1EC] dark:border-[#2C3A52] bg-white dark:bg-[#1D283B] text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-[#243147] cursor-pointer whitespace-nowrap"
                >
                  <Upload className="h-3.5 w-3.5 text-slate-400" />
                  <span>Choose JSON file</span>
                </button>
              </div>
            </div>

            {/* JSON Payload Editor */}
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <label
                  htmlFor="import-json-textarea"
                  className="text-xs font-medium text-slate-600 dark:text-slate-300"
                >
                  JSON payload
                </label>
                {jsonValidation && (
                  <span
                    className={`text-[11px] font-medium tabular-nums ${
                      jsonValidation.ok
                        ? 'text-emerald-700 dark:text-emerald-400'
                        : 'text-rose-600 dark:text-rose-400'
                    }`}
                  >
                    {jsonValidation.ok
                      ? `Valid JSON · ${jsonValidation.count} row(s) ready`
                      : jsonValidation.message}
                  </span>
                )}
              </div>
              <textarea
                id="import-json-textarea"
                rows={8}
                value={jsonText}
                onChange={(e) => setJsonText(e.target.value)}
                spellCheck={false}
                placeholder='[{"Name": "Ann", "Email": "ann@example.com"}]'
                className={`${inputClass} font-mono text-xs bg-[#FAFBFD] dark:bg-[#111927]`}
              />
            </div>

            <div className="pt-3 border-t border-[#E6EBF2] dark:border-[#243147] flex flex-wrap items-center justify-between gap-3">
              <button
                type="button"
                onClick={() => setJsonText('')}
                disabled={busy || !jsonText}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-[#D8E1EC] dark:border-[#2C3A52] text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-[#1D283B] cursor-pointer disabled:opacity-50"
              >
                <X className="h-3.5 w-3.5 text-slate-400" />
                <span>Clear JSON</span>
              </button>

              <button
                type="button"
                onClick={() => importJson(jsonText)}
                disabled={busy || !jsonText.trim() || jsonValidation?.ok === false}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-xs font-semibold text-white cursor-pointer disabled:opacity-50"
              >
                <Upload className="h-3.5 w-3.5" />
                <span>Import rows</span>
              </button>
            </div>
          </div>
        )}

        {detailTab === 'columns' && (
          <div className="divide-y divide-[#EEF2F7] dark:divide-[#243147]">
            {table.columns.map((c) => {
              const flags = [
                c.primaryKey ? 'PK' : null,
                c.identity ? 'IDENTITY' : null,
                c.unique ? 'UNIQUE' : null,
                !c.nullable ? 'NOT NULL' : null,
                c.default ? `DEFAULT ${c.default}` : null,
                c.references ? `FK → ${c.references}` : null,
              ].filter(Boolean);

              return (
                <div
                  key={c.name}
                  className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-xs"
                >
                  <div className="flex items-center gap-2.5">
                    <span className="font-mono font-semibold text-[#172033] dark:text-[#F1F5F9]">
                      {c.name}
                    </span>
                    <span className="font-mono text-blue-700 dark:text-blue-400">{c.type}</span>
                  </div>
                  {flags.length > 0 && (
                    <div className="font-mono text-[11px] text-slate-500 dark:text-slate-400">
                      {flags.join(' · ')}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
          </motion.div>
        </AnimatePresence>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
export function TablesPage({
  refreshKey,
  databaseName,
  serverName,
  onNotify,
}: {
  refreshKey: number;
  databaseName?: string;
  serverName?: string;
  onNotify: (msg: string, tone?: 'success' | 'error') => void;
}) {
  const [tables, setTables] = useState<TableInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<string | 'new'>('new');
  const [filter, setFilter] = useState('');
  const [favorites, setFavorites] = useState<Set<string>>(new Set());

  useEffect(() => {
    favoritesApi
      .list()
      .then((f) => setFavorites(new Set(f.filter((x) => x.kind === 'table').map((x) => favKey(x.schema, x.name)))))
      .catch(() => {});
  }, [refreshKey]);

  const toggleFavorite = async (t: TableInfo) => {
    const k = favKey(t.schema, t.name);
    const was = favorites.has(k);
    const flip = (prev: Set<string>, on: boolean) => {
      const n = new Set(prev);
      if (on) n.add(k);
      else n.delete(k);
      return n;
    };
    setFavorites((prev) => flip(prev, !was));
    try {
      if (was) await favoritesApi.remove('table', t.schema, t.name);
      else await favoritesApi.add('table', t.schema, t.name);
    } catch (e) {
      setFavorites((prev) => flip(prev, was));
      onNotify(errMsg(e), 'error');
    }
  };

  const load = useCallback(async (withSkeleton = false) => {
    if (withSkeleton) setLoading(true);
    try {
      setTables(await api.tables());
    } catch (e) {
      onNotify(errMsg(e), 'error');
      setTables([]);
    } finally {
      setLoading(false);
    }
  }, [onNotify]);

  useEffect(() => {
    void load(true);
  }, [load, refreshKey]);

  const filterInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (document.querySelector('[role="dialog"]')) return;
      const mod = e.ctrlKey || e.metaKey;
      if (e.altKey && !mod && !e.shiftKey && e.key.toLowerCase() === 'n') {
        e.preventDefault();
        setSelected('new');
        return;
      }
      if (e.key === '/' && !mod && !e.altKey && !isEditableTarget(e.target)) {
        e.preventDefault();
        filterInputRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const current = tables.find((t) => `${t.schema}.${t.name}` === selected);
  const shown = tables
    .filter((t) => `${t.schema}.${t.name}`.toLowerCase().includes(filter.toLowerCase()))
    .sort((a, b) => Number(favorites.has(favKey(b.schema, b.name))) - Number(favorites.has(favKey(a.schema, a.name))));

  return (
    <div className="space-y-5">
      <DatabaseSummary
        tables={tables}
        databaseName={databaseName}
        serverName={serverName}
        loading={loading}
        selectedTableKey={selected}
        onSelectTable={(key) => setSelected(key)}
      />

      <div data-tour="tables-explorer" className="grid gap-5 lg:grid-cols-[272px_1fr] items-start">
        <aside className="rounded-xl bg-white dark:bg-[#161F30] border border-[#E6EBF2] dark:border-[#243147] overflow-hidden">
        <div className="px-4 py-3 border-b border-[#E6EBF2] dark:border-[#243147] flex flex-wrap items-center justify-between gap-2">
          <span className="font-display text-xs font-semibold text-[#172033] dark:text-[#F1F5F9]">
            Tables ({tables.length})
          </span>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => void load(true)}
              className="inline-flex items-center gap-1 px-2 py-1 rounded-md border border-[#D8E1EC] dark:border-[#2C3A52] text-[11px] font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-[#1D283B] cursor-pointer whitespace-nowrap"
            >
              <RefreshCw className={`h-3 w-3 ${loading ? 'animate-spin' : ''}`} />
              <span>Refresh</span>
            </button>
            <button
              type="button"
              onClick={() => setSelected('new')}
              title="New table (Alt + N)"
              className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-blue-50 dark:bg-blue-950/60 border border-blue-200 dark:border-blue-800 text-[11px] font-semibold text-blue-700 dark:text-blue-300 hover:bg-blue-100 dark:hover:bg-blue-950 cursor-pointer whitespace-nowrap"
            >
              <Plus className="h-3 w-3" />
              <span>New</span>
            </button>
          </div>
        </div>

        <div className="p-3 border-b border-[#E6EBF2] dark:border-[#243147]">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
            <input
              ref={filterInputRef}
              placeholder="Filter tables... (/)"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              className="w-full rounded-lg border border-[#D8E1EC] dark:border-[#2C3A52] bg-[#F8FAFC] dark:bg-[#1D283B] pl-8 pr-3 py-1.5 text-xs text-[#172033] dark:text-[#E6ECF5] placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
            />
          </div>
        </div>

        <div className="divide-y divide-[#EEF2F7] dark:divide-[#243147] max-h-[60vh] overflow-y-auto">
          {loading ? (
            <SidebarListSkeleton rows={5} />
          ) : (
            <>
              {shown.length === 0 && (
                <p className="px-4 py-8 text-center text-xs text-slate-500 dark:text-slate-400">
                  {tables.length === 0 ? 'No tables yet.' : 'No matching tables.'}
                </p>
              )}
          {shown.map((t) => {
            const key = `${t.schema}.${t.name}`;
            const active = selected === key;
            const fav = favorites.has(favKey(t.schema, t.name));
            return (
              <div
                key={key}
                className={`flex items-center transition-colors ${
                  active
                    ? 'bg-blue-50/90 dark:bg-blue-950/45'
                    : 'hover:bg-[#F8FAFC] dark:hover:bg-[#1D283B]/60'
                }`}
              >
              <button
                type="button"
                onClick={() => setSelected(key)}
                className="flex-1 min-w-0 flex items-center justify-between gap-2 pl-4 pr-2 py-2.5 text-left cursor-pointer"
              >
                <span className="inline-flex items-center gap-2 min-w-0">
                  <Table2
                    className={`h-3.5 w-3.5 shrink-0 ${
                      active ? 'text-blue-600 dark:text-blue-400' : 'text-slate-400'
                    }`}
                  />
                  <span
                    className={`text-xs font-mono font-medium truncate ${
                      active
                        ? 'text-blue-900 dark:text-blue-200'
                        : 'text-[#172033] dark:text-[#E6ECF5]'
                    }`}
                  >
                    {key}
                  </span>
                </span>
                <span className="text-[11px] text-slate-400 tabular-nums shrink-0">
                  {t.rowCount}
                </span>
              </button>
              <button
                type="button"
                onClick={() => void toggleFavorite(t)}
                aria-pressed={fav}
                aria-label={fav ? `Remove ${t.name} from favorites` : `Add ${t.name} to favorites`}
                title={fav ? 'Remove from favorites' : 'Add to favorites'}
                className="shrink-0 px-3 py-2.5 cursor-pointer"
              >
                <Star
                  className={`h-3.5 w-3.5 ${
                    fav ? 'fill-amber-400 text-amber-400' : 'text-slate-300 dark:text-slate-600 hover:text-amber-400'
                  }`}
                />
              </button>
              </div>
            );
          })}
            </>
          )}
        </div>
      </aside>

      {current ? (
        <TableDetail
          key={selected}
          table={current}
          onChanged={() => void load(false)}
          onNotify={onNotify}
        />
      ) : (
        <TableBuilder
          tables={tables}
          onCreated={async (key) => {
            await load(false);
            setSelected(key);
          }}
          onNotify={onNotify}
        />
      )}
      </div>
    </div>
  );
}
