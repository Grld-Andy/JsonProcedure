import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  AlignLeft,
  BookmarkPlus,
  ChevronDown,
  ChevronRight,
  FileCode2,
  History,
  Play,
  Plus,
  RefreshCw,
  Save,
  Search,
  Star,
  Trash2,
} from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import {
  api,
  exportData,
  resultToJson,
  resultToSheets,
  type ExecutionResult,
  type ExportFormat,
  type ProcedureDetail,
  type ProcedureSummary,
} from '../lib/api';
import {
  draftsApi,
  favKey,
  favoritesApi,
  historyApi,
  parameterSetsApi,
  type ExecutionRecordSummary,
  type ParameterSet,
} from '../lib/userData';
import { ExportMenu } from './TablesPage';
import { getPrimaryModLabel, isEditableTarget } from '../components/ShortcutsModal';
import {
  DataGridSkeleton,
  errMsg,
  ExecutionView,
  Field,
  inputClass,
  SidebarListSkeleton,
} from '../components/shared';

const TEMPLATE = `CREATE OR ALTER PROCEDURE dbo.MyProcedure
    @Id int = NULL
AS
BEGIN
    SET NOCOUNT ON;
    -- Return rows; add FOR JSON PATH to get JSON straight from SQL Server
    SELECT 1 AS Id, N'hello' AS Message;
END`;

/** Convert a stored definition (CREATE ...) into a re-runnable CREATE OR ALTER script. */
function toAlterable(def: string) {
  return def.replace(
    /^(\s*(?:--[^\n]*\n|\/\*[\s\S]*?\*\/|\s)*)CREATE\s+PROC(EDURE)?/i,
    '$1CREATE OR ALTER PROCEDURE'
  );
}

function coerce(type: string, text: string): unknown {
  const t = text.trim();
  if (t.toLowerCase() === 'null') return null;
  const base = type.replace(/\(.*\)/, '');
  if (
    [
      'int',
      'bigint',
      'smallint',
      'tinyint',
      'decimal',
      'numeric',
      'float',
      'real',
      'money',
      'smallmoney',
    ].includes(base)
  ) {
    const n = Number(t);
    if (Number.isNaN(n)) throw new Error(`"${text}" is not a number`);
    return n;
  }
  if (base === 'bit') return ['1', 'true', 'yes'].includes(t.toLowerCase());
  return text;
}

// ---- SQL tokenizer, syntax highlighter and formatter -------------------------
type SqlTok = {
  kind: 'ws' | 'comment' | 'string' | 'ident' | 'var' | 'number' | 'word' | 'punct';
  text: string;
};

const SQL_TOKEN_RE =
  /(\s+)|(--[^\n]*|\/\*[\s\S]*?(?:\*\/|$))|(N?'(?:[^']|'')*(?:'|$)|"(?:[^"]|"")*(?:"|$))|(\[[^\]]*(?:\]|$))|(@@?\w+|#\w+)|(\d+(?:\.\d+)?\b)|([A-Za-z_][\w$#]*)|([\s\S])/g;

function tokenizeSql(src: string): SqlTok[] {
  const out: SqlTok[] = [];
  const re = new RegExp(SQL_TOKEN_RE.source, 'g');
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    if (m[0] === '') {
      re.lastIndex++;
      continue;
    }
    const kind: SqlTok['kind'] = m[1]
      ? 'ws'
      : m[2]
        ? 'comment'
        : m[3]
          ? 'string'
          : m[4]
            ? 'ident'
            : m[5]
              ? 'var'
              : m[6]
                ? 'number'
                : m[7]
                  ? 'word'
                  : 'punct';
    out.push({ kind, text: m[0] });
  }
  return out;
}

const words = (s: string) => new Set(s.split(/\s+/).filter(Boolean));

// Keywords that are safe to upper-case when formatting.
const FMT_KEYWORDS = words(
  'SELECT FROM WHERE GROUP BY ORDER HAVING JOIN INNER LEFT RIGHT FULL OUTER CROSS ON AS AND OR NOT IN IS NULL LIKE BETWEEN EXISTS UNION ALL DISTINCT TOP INSERT INTO VALUES UPDATE SET DELETE CREATE ALTER DROP TABLE VIEW INDEX PROCEDURE PROC FUNCTION TRIGGER BEGIN END IF ELSE WHILE RETURN DECLARE EXEC EXECUTE CASE WHEN THEN WITH DEFAULT PRIMARY FOREIGN REFERENCES CONSTRAINT UNIQUE CHECK TRY CATCH TRANSACTION TRAN COMMIT ROLLBACK ASC DESC PRINT THROW RAISERROR TRUNCATE FOR EXCEPT INTERSECT APPLY'
);
// Extra words that are only highlighted.
const HL_EXTRA = words('PATH JSON XML OFFSET FETCH NEXT ROWS ONLY OVER PARTITION OUTPUT NOCOUNT GO USE');
const SQL_TYPES = words(
  'int bigint smallint tinyint bit decimal numeric float real money smallmoney char varchar nchar nvarchar text ntext date datetime datetime2 smalldatetime time datetimeoffset uniqueidentifier varbinary binary xml sql_variant'
);
const SQL_FUNCS = words(
  'COUNT SUM AVG MIN MAX ISNULL COALESCE NULLIF CAST CONVERT GETDATE SYSDATETIME DATEADD DATEDIFF DATEPART YEAR MONTH DAY LEN LTRIM RTRIM TRIM UPPER LOWER SUBSTRING REPLACE CHARINDEX CONCAT STRING_AGG ROW_NUMBER RANK DENSE_RANK ABS ROUND FLOOR CEILING NEWID SCOPE_IDENTITY ISJSON JSON_VALUE JSON_QUERY OPENJSON IIF FORMAT EOMONTH TRY_CAST TRY_CONVERT'
);

function highlightSql(src: string): ReactNode[] {
  return tokenizeSql(src).map((t, i) => {
    let cls = '';
    if (t.kind === 'comment') cls = 'text-slate-400 dark:text-slate-500 italic';
    else if (t.kind === 'string') cls = 'text-emerald-600 dark:text-emerald-400';
    else if (t.kind === 'ident') cls = 'text-teal-700 dark:text-teal-300';
    else if (t.kind === 'var') cls = 'text-violet-600 dark:text-violet-400';
    else if (t.kind === 'number') cls = 'text-amber-600 dark:text-amber-400';
    else if (t.kind === 'word') {
      const u = t.text.toUpperCase();
      if (FMT_KEYWORDS.has(u) || HL_EXTRA.has(u)) cls = 'text-blue-600 dark:text-blue-400';
      else if (SQL_TYPES.has(t.text.toLowerCase())) cls = 'text-cyan-700 dark:text-cyan-300';
      else if (SQL_FUNCS.has(u)) cls = 'text-fuchsia-600 dark:text-fuchsia-400';
    }
    return cls ? (
      <span key={i} className={cls}>
        {t.text}
      </span>
    ) : (
      t.text
    );
  });
}

const BREAK_BEFORE = words(
  'SELECT FROM WHERE HAVING UNION EXCEPT INTERSECT INSERT UPDATE DELETE VALUES SET DECLARE EXEC EXECUTE RETURN IF ELSE WHILE PRINT THROW RAISERROR TRUNCATE COMMIT ROLLBACK'
);
const LIST_CLAUSES = words('SELECT GROUP ORDER SET PARAMS DECLARE');
const CLAUSE_WORDS = words('SELECT FROM WHERE HAVING SET DECLARE UPDATE INSERT DELETE VALUES');
const JOIN_START = words('INNER LEFT RIGHT FULL CROSS');
const JOIN_MODS = words('INNER LEFT RIGHT FULL CROSS OUTER');
const IF_NO_BREAK_PREV = words('ELSE TABLE VIEW PROCEDURE PROC FUNCTION INDEX TRIGGER SCHEMA DATABASE COLUMN CONSTRAINT');
const INDENT = '    ';

/** Simple layout formatter: only changes whitespace and keyword case. */
function formatSql(src: string): string {
  type T = { kind: SqlTok['kind']; text: string; sp: boolean; nl: number };
  const toks: T[] = [];
  let sp = false;
  let nl = 0;
  for (const t of tokenizeSql(src)) {
    if (t.kind === 'ws') {
      sp = true;
      nl += (t.text.match(/\n/g) || []).length;
      continue;
    }
    toks.push({ kind: t.kind, text: t.text, sp, nl });
    sp = false;
    nl = 0;
  }

  const out: string[] = [];
  let cur = '';
  let curExtra = 0;
  let pendingExtra = 0;
  let indent = 0;
  let paren = 0;
  let caseDepth = 0;
  let clause = '';
  let between = false;
  let afterEnd = false;
  let isCreate = false;
  let lastUpper = '';

  const flush = () => {
    if (cur.trim()) out.push(INDENT.repeat(Math.max(0, indent + curExtra)) + cur.trim());
    cur = '';
    curExtra = 0;
  };
  const add = (t: T, text: string, noSpace = false) => {
    if (cur === '') {
      curExtra = pendingExtra;
      pendingExtra = 0;
      if (t.nl >= 2 && out.length > 0 && out[out.length - 1] !== '') out.push('');
    } else if ((t.sp || lastUpper === ',') && !noSpace) {
      cur += ' ';
    }
    cur += text;
  };

  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    const isWord = t.kind === 'word';
    const upper = isWord ? t.text.toUpperCase() : t.text;
    const next = toks[i + 1];
    const nextUpper = next ? (next.kind === 'word' ? next.text.toUpperCase() : next.text) : '';
    const afterDot = lastUpper === '.';
    let kw = isWord && !afterDot && FMT_KEYWORDS.has(upper);
    if (isWord && !afterDot && ((lastUpper === 'FOR' && (upper === 'JSON' || upper === 'XML')) || (lastUpper === 'JSON' && upper === 'PATH'))) kw = true;
    const text = kw ? upper : t.text;

    if (afterEnd) {
      afterEnd = false;
      if (isWord && (upper === 'TRY' || upper === 'CATCH')) {
        add(t, text);
        lastUpper = upper;
        flush();
        continue;
      }
      if (t.text === ';') {
        add(t, ';', true);
        lastUpper = ';';
        flush();
        continue;
      }
      flush();
    }

    if (t.kind === 'comment') {
      const multiline = t.text.indexOf('\n') >= 0;
      if (t.nl > 0 || multiline) flush();
      if (multiline) {
        if (t.nl >= 2 && out.length > 0 && out[out.length - 1] !== '') out.push('');
        out.push(INDENT.repeat(indent) + t.text);
      } else {
        add(t, t.text);
        if (t.text.startsWith('--')) flush();
      }
      continue;
    }

    if (t.kind === 'punct') {
      if (t.text === '(') {
        add(t, '(');
        paren++;
      } else if (t.text === ')') {
        paren = Math.max(0, paren - 1);
        add(t, ')');
      } else if (t.text === ',') {
        add(t, ',', true);
        if (paren === 0 && LIST_CLAUSES.has(clause)) {
          flush();
          pendingExtra = 1;
        }
      } else if (t.text === ';') {
        add(t, ';', true);
        if (paren === 0) {
          flush();
          clause = '';
          caseDepth = 0;
          between = false;
          isCreate = false;
          pendingExtra = 0;
        }
      } else {
        add(t, t.text);
      }
      lastUpper = t.text;
      continue;
    }

    if (t.kind === 'var') {
      if (paren === 0 && clause === 'PARAMS' && lastUpper !== '=' && cur !== '') {
        flush();
        pendingExtra = 1;
      }
      add(t, t.text);
      lastUpper = upper;
      continue;
    }

    if (!isWord) {
      add(t, t.text);
      lastUpper = upper;
      continue;
    }

    // ---- words ----
    if (kw && upper === 'BETWEEN') between = true;
    if (kw && upper === 'CASE') {
      caseDepth++;
      add(t, text);
      lastUpper = upper;
      continue;
    }
    if (kw && upper === 'END') {
      if (caseDepth > 0) {
        caseDepth--;
        add(t, text);
      } else if (paren === 0) {
        flush();
        indent = Math.max(0, indent - 1);
        pendingExtra = 0;
        clause = '';
        add(t, text);
        afterEnd = true;
      } else {
        add(t, text);
      }
      lastUpper = upper;
      continue;
    }
    if (kw && upper === 'BEGIN' && paren === 0) {
      flush();
      pendingExtra = 0;
      add(t, text);
      if (nextUpper === 'TRAN' || nextUpper === 'TRANSACTION') {
        lastUpper = upper;
        continue;
      }
      if (nextUpper === 'TRY' || nextUpper === 'CATCH') {
        i++;
        add(next, nextUpper);
      }
      flush();
      indent++;
      clause = '';
      lastUpper = upper;
      continue;
    }
    if (kw && upper === 'AS' && paren === 0 && clause === 'PARAMS') {
      flush();
      pendingExtra = 0;
      add(t, text);
      flush();
      clause = '';
      isCreate = false;
      lastUpper = upper;
      continue;
    }

    let brk = false;
    let extra = 0;
    if (kw && paren === 0) {
      if (BREAK_BEFORE.has(upper)) {
        brk = true;
        if (upper === 'IF' && IF_NO_BREAK_PREV.has(lastUpper)) brk = false;
        if (upper === 'ELSE' && caseDepth > 0) brk = false;
        if (upper === 'FROM' && lastUpper === 'DELETE') brk = false;
      } else if (upper === 'GROUP' || upper === 'ORDER') {
        brk = nextUpper === 'BY';
      } else if (upper === 'FOR') {
        brk = nextUpper === 'JSON' || nextUpper === 'XML';
      } else if (JOIN_START.has(upper)) {
        brk = clause === 'FROM' && !((upper === 'LEFT' || upper === 'RIGHT') && next && next.text === '(');
      } else if (upper === 'JOIN') {
        brk = clause === 'FROM' && !JOIN_MODS.has(lastUpper);
      } else if (upper === 'ON') {
        brk = clause === 'FROM';
        extra = 1;
      } else if (upper === 'AND' || upper === 'OR') {
        if (upper === 'AND' && between) {
          between = false;
        } else if (caseDepth === 0 && (clause === 'WHERE' || clause === 'HAVING' || clause === 'FROM')) {
          brk = true;
          extra = 1;
        }
      }
    }
    if (kw && upper === 'AND') between = false;
    if (brk) {
      flush();
      pendingExtra = extra;
    }
    if (kw && paren === 0) {
      if (CLAUSE_WORDS.has(upper)) {
        clause = upper;
        isCreate = false;
      } else if ((upper === 'GROUP' || upper === 'ORDER') && nextUpper === 'BY') {
        clause = upper;
      } else if (upper === 'CREATE' || upper === 'ALTER') {
        isCreate = true;
      } else if ((upper === 'PROCEDURE' || upper === 'PROC') && isCreate) {
        clause = 'PARAMS';
      }
    }
    add(t, text);
    lastUpper = upper;
  }
  flush();
  return out.join('\n').trim();
}

const EDITOR_TEXT = 'p-4 font-mono text-[13px] leading-6 whitespace-pre-wrap break-words';

/** Textarea with a syntax-highlighted layer rendered underneath it. */
function SqlEditor({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const taRef = useRef<HTMLTextAreaElement>(null);
  const highlighted = useMemo(() => highlightSql(value), [value]);

  const fit = useCallback(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = Math.max(ta.scrollHeight, 300) + 'px';
  }, []);

  useLayoutEffect(() => {
    fit();
  }, [value, fit]);

  useEffect(() => {
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, [fit]);

  return (
    <div className="relative bg-[#FAFBFD] dark:bg-[#111927]">
      <pre
        aria-hidden="true"
        style={{ tabSize: 4 }}
        className={'pointer-events-none absolute inset-0 m-0 overflow-hidden text-[#172033] dark:text-[#E6ECF5] ' + EDITOR_TEXT}
      >
        {highlighted}
        {'\n'}
      </pre>
      <textarea
        ref={taRef}
        aria-label="T-SQL procedure script"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        spellCheck={false}
        rows={12}
        style={{ tabSize: 4 }}
        className={'relative block w-full resize-none overflow-hidden bg-transparent text-transparent caret-[#172033] dark:caret-white selection:bg-blue-500/25 focus:outline-none ' + EDITOR_TEXT}
      />
    </div>
  );
}

export function ProceduresPage({
  refreshKey,
  onNotify,
}: {
  refreshKey: number;
  onNotify: (msg: string, tone?: 'success' | 'error') => void;
}) {
  const [list, setList] = useState<ProcedureSummary[]>([]);
  const [loadingList, setLoadingList] = useState(true);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [executing, setExecuting] = useState(false);
  const [selected, setSelected] = useState<{ schema: string; name: string } | null>(null);
  const [detail, setDetail] = useState<ProcedureDetail | null>(null);
  const [script, setScript] = useState(TEMPLATE);
  const [values, setValues] = useState<Record<string, string>>({});
  const [result, setResult] = useState<ExecutionResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState('');
  const [favorites, setFavorites] = useState<Set<string>>(new Set());
  const [history, setHistory] = useState<ExecutionRecordSummary[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [paramSets, setParamSets] = useState<ParameterSet[]>([]);
  const [setLabel, setSetLabel] = useState('');
  const [savingSet, setSavingSet] = useState(false);

  // Draft autosave: `baseline` is the last saved text of whatever is open; `draftKey` says which
  // procedure the editor currently belongs to (null while another one is still loading).
  const baselineRef = useRef(TEMPLATE);
  const draftKeyRef = useRef<{ schema: string | null; name: string | null } | null>(null);
  const pendingDraftRef = useRef<{ schema: string | null; name: string | null; script: string } | null>(null);

  const load = useCallback(async (withSkeleton = false) => {
    if (withSkeleton) setLoadingList(true);
    try {
      setList(await api.procedures());
    } catch (e) {
      onNotify(errMsg(e), 'error');
      setList([]);
    } finally {
      setLoadingList(false);
    }
  }, [onNotify]);

  useEffect(() => {
    void load(true);
  }, [load, refreshKey]);

  const open = async (p: { schema: string; name: string }) => {
    setSelected(p);
    setDetail(null);
    setResult(null);
    setLoadingDetail(true);
    try {
      const d = await api.procedure(p.schema, p.name);
      const base = d.definition
        ? toAlterable(d.definition)
        : '-- This procedure is encrypted; its definition cannot be read.';
      const draft = d.definition ? await draftsApi.get(p.schema, p.name).catch(() => null) : null;
      baselineRef.current = base;
      draftKeyRef.current = { schema: p.schema, name: p.name };
      setDetail(d);
      setValues({});
      if (draft && draft.script !== base) {
        setScript(draft.script);
        onNotify('Restored your unsaved changes', 'success');
      } else setScript(base);
    } catch (e) {
      onNotify(errMsg(e), 'error');
    } finally {
      setLoadingDetail(false);
    }
  };

  const newProc = () => {
    setSelected(null);
    setDetail(null);
    setValues({});
    setResult(null);
    baselineRef.current = TEMPLATE;
    draftKeyRef.current = null;
    void restoreNewDraft();
  };

  /** Brings back the unsaved "new procedure" text, or the template when there is none. */
  const restoreNewDraft = async () => {
    const draft = await draftsApi.get(null, null).catch(() => null);
    baselineRef.current = TEMPLATE;
    draftKeyRef.current = { schema: null, name: null };
    setScript(draft && draft.script !== TEMPLATE ? draft.script : TEMPLATE);
  };

  // Only on first mount: a later workspace refresh must not replace what is open in the editor.
  useEffect(() => {
    void restoreNewDraft();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    favoritesApi
      .list()
      .then((f) => setFavorites(new Set(f.filter((x) => x.kind === 'procedure').map((x) => favKey(x.schema, x.name)))))
      .catch(() => {});
  }, [refreshKey]);

  // Debounced draft autosave. Text equal to the saved version discards the draft instead.
  useEffect(() => {
    const key = draftKeyRef.current;
    if (!key || loadingDetail) return;
    if (script === baselineRef.current) {
      pendingDraftRef.current = null;
      void draftsApi.discard(key.schema, key.name).catch(() => {});
      return;
    }
    pendingDraftRef.current = { ...key, script };
    const t = window.setTimeout(() => {
      pendingDraftRef.current = null;
      void draftsApi.save(key.schema, key.name, script).catch(() => {});
    }, 800);
    return () => window.clearTimeout(t);
  }, [script, loadingDetail]);

  // Leaving the page within the debounce window must not lose the last edits.
  useEffect(
    () => () => {
      const p = pendingDraftRef.current;
      if (p) void draftsApi.save(p.schema, p.name, p.script).catch(() => {});
    },
    []
  );

  // History and saved parameter sets for the open procedure.
  const loadRunExtras = useCallback(async (p: { schema: string; name: string } | null) => {
    if (!p) {
      setHistory([]);
      setParamSets([]);
      return;
    }
    const [h, ps] = await Promise.all([
      historyApi.list({ schema: p.schema, name: p.name, limit: 20 }).catch(() => []),
      parameterSetsApi.list(p.schema, p.name).catch(() => []),
    ]);
    setHistory(h);
    setParamSets(ps);
  }, []);

  useEffect(() => {
    void loadRunExtras(selected);
  }, [selected, loadRunExtras]);

  const toggleFavorite = async (schema: string, name: string) => {
    const key = favKey(schema, name);
    const was = favorites.has(key);
    setFavorites((prev) => {
      const n = new Set(prev);
      if (was) n.delete(key);
      else n.add(key);
      return n;
    });
    try {
      if (was) await favoritesApi.remove('procedure', schema, name);
      else await favoritesApi.add('procedure', schema, name);
    } catch (e) {
      setFavorites((prev) => {
        const n = new Set(prev);
        if (was) n.add(key);
        else n.delete(key);
        return n;
      });
      onNotify(errMsg(e), 'error');
    }
  };

  const loadHistoryEntry = async (id: number) => {
    try {
      const rec = await historyApi.get(id);
      if (rec.parameters) {
        const v: Record<string, string> = {};
        for (const [k, val] of Object.entries(rec.parameters)) v[k] = val === null ? 'null' : String(val);
        setValues(v);
      }
      if (rec.result) setResult(rec.result as ExecutionResult);
      else if (rec.error) onNotify(`That run failed: ${rec.error}`, 'error');
    } catch (e) {
      onNotify(errMsg(e), 'error');
    }
  };

  const saveParamSet = async () => {
    if (!selected || !setLabel.trim()) return;
    const params: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(values)) if (v !== '') params[k] = v;
    try {
      await parameterSetsApi.save(selected.schema, selected.name, setLabel.trim(), params);
      setSetLabel('');
      setSavingSet(false);
      onNotify('Parameter set saved', 'success');
      await loadRunExtras(selected);
    } catch (e) {
      onNotify(errMsg(e), 'error');
    }
  };

  const removeParamSet = async (id: number) => {
    try {
      await parameterSetsApi.remove(id);
      await loadRunExtras(selected);
    } catch (e) {
      onNotify(errMsg(e), 'error');
    }
  };

  const save = async () => {
    setBusy(true);
    try {
      await api.saveProcedure(script);
      // The saved text is now the baseline, so the draft is no longer needed.
      baselineRef.current = script;
      const key = draftKeyRef.current;
      if (key) await draftsApi.discard(key.schema, key.name).catch(() => {});
      onNotify('Procedure saved', 'success');
      await load(false);
      const m = /PROC(?:EDURE)?\s+(?:\[?(\w+)\]?\s*\.\s*)?\[?(\w+)\]?/i.exec(script);
      if (m) await open({ schema: m[1] ?? 'dbo', name: m[2] });
    } catch (e) {
      onNotify(errMsg(e), 'error');
    } finally {
      setBusy(false);
    }
  };

  const run = async () => {
    if (!selected || !detail) return;
    setBusy(true);
    setExecuting(true);
    try {
      const args: Record<string, unknown> = {};
      for (const p of detail.parameters) {
        const v = values[p.name];
        if (v !== undefined && v !== '') args[p.name] = coerce(p.type, v);
      }
      const res = await api.execute(selected.schema, selected.name, args);
      setResult(res);
      onNotify(`${selected.schema}.${selected.name} executed (${res.elapsedMs} ms)`, 'success');
    } catch (e) {
      onNotify(errMsg(e), 'error');
      setResult(null);
    } finally {
      void loadRunExtras(selected);
      setBusy(false);
      setExecuting(false);
    }
  };

  const exportResult = (format: ExportFormat) => {
    if (!result) return;
    const baseName = selected ? selected.schema + '.' + selected.name : 'procedure-results';
    try {
      const file = exportData({
        format,
        baseName,
        sheets: resultToSheets(result),
        json: resultToJson(result),
      });
      onNotify('Exported results to ' + file, 'success');
    } catch (e) {
      onNotify(errMsg(e), 'error');
    }
  };

  const formatScript = () => {
    const next = formatSql(script);
    if (next === script) {
      onNotify('Script is already formatted', 'success');
      return;
    }
    setScript(next);
    onNotify('SQL formatted', 'success');
  };
  const filterInputRef = useRef<HTMLInputElement>(null);
  const modLabel = getPrimaryModLabel();
  const shortcutRef = useRef({
    save: () => {},
    run: () => {},
    newProc: () => {},
    canRun: false,
    busy: false,
    format: () => {},
  });

  shortcutRef.current = {
    save: () => void save(),
    run: () => void run(),
    newProc,
    canRun: Boolean(selected && detail && !loadingDetail),
    busy,
    format: formatScript,
  };

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (document.querySelector('[role="dialog"]')) return;

      const mod = e.ctrlKey || e.metaKey;
      if (mod && !e.altKey && e.key === 'Enter') {
        if (shortcutRef.current.canRun && !shortcutRef.current.busy) {
          e.preventDefault();
          shortcutRef.current.run();
        }
        return;
      }

      if (mod && e.shiftKey && !e.altKey && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        shortcutRef.current.format();
        return;
      }
      if (mod && !e.altKey && e.key.toLowerCase() === 's') {
        e.preventDefault();
        if (!shortcutRef.current.busy) {
          shortcutRef.current.save();
        }
        return;
      }

      if (e.altKey && !mod && !e.shiftKey && e.key.toLowerCase() === 'n') {
        e.preventDefault();
        shortcutRef.current.newProc();
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

  const shown = list
    .filter((p) => `${p.schema}.${p.name}`.toLowerCase().includes(filter.toLowerCase()))
    .sort((a, b) => Number(favorites.has(favKey(b.schema, b.name))) - Number(favorites.has(favKey(a.schema, a.name))));

  return (
    <div data-tour="procedures-runner" className="grid gap-5 lg:grid-cols-[272px_1fr] items-start">
      {/* Left Procedures List */}
      <aside className="rounded-xl bg-white dark:bg-[#161F30] border border-[#E6EBF2] dark:border-[#243147] overflow-hidden">
        <div className="px-4 py-3 border-b border-[#E6EBF2] dark:border-[#243147] flex flex-wrap items-center justify-between gap-2">
          <span className="font-display text-xs font-semibold text-[#172033] dark:text-[#F1F5F9]">
            Procedures ({list.length})
          </span>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => void load(true)}
              className="inline-flex items-center gap-1 px-2 py-1 rounded-md border border-[#D8E1EC] dark:border-[#2C3A52] text-[11px] font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-[#1D283B] cursor-pointer whitespace-nowrap"
            >
              <RefreshCw className={`h-3 w-3 ${loadingList ? 'animate-spin' : ''}`} />
              <span>Refresh</span>
            </button>
            <button
              type="button"
              onClick={newProc}
              title="New procedure (Alt + N)"
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
              placeholder="Filter... (/)"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              className="w-full rounded-lg border border-[#D8E1EC] dark:border-[#2C3A52] bg-[#F8FAFC] dark:bg-[#1D283B] pl-8 pr-3 py-1.5 text-xs text-[#172033] dark:text-[#E6ECF5] placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
            />
          </div>
        </div>

        <div className="max-h-[60vh] overflow-y-auto divide-y divide-[#EEF2F7] dark:divide-[#243147]">
          {loadingList ? (
            <SidebarListSkeleton rows={5} />
          ) : (
            <>
              {shown.length === 0 && (
                <p className="px-4 py-8 text-center text-xs text-slate-500 dark:text-slate-400">
                  No procedures found.
                </p>
              )}
              {shown.map((p) => {
                const active = selected?.schema === p.schema && selected.name === p.name;
                const fav = favorites.has(favKey(p.schema, p.name));
                return (
                  <div
                    key={`${p.schema}.${p.name}`}
                    className={`flex items-center transition-colors ${
                      active
                        ? 'bg-blue-50/90 dark:bg-blue-950/45'
                        : 'hover:bg-[#F8FAFC] dark:hover:bg-[#1D283B]/60'
                    }`}
                  >
                  <button
                    type="button"
                    onClick={() => open(p)}
                    className="flex-1 min-w-0 flex items-center justify-between gap-2 pl-4 pr-2 py-2.5 text-left cursor-pointer"
                  >
                    <span className="inline-flex items-center gap-2 min-w-0">
                      <FileCode2
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
                        {p.schema}.{p.name}
                      </span>
                    </span>
                    <span className="text-[11px] text-slate-400 tabular-nums shrink-0">
                      {p.parameterCount}p
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => void toggleFavorite(p.schema, p.name)}
                    aria-pressed={fav}
                    aria-label={fav ? `Remove ${p.name} from favorites` : `Add ${p.name} to favorites`}
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

      {/* Unified Editor + Execute Surface */}
      <div className="space-y-5 min-w-0">
        <section className="rounded-xl bg-white dark:bg-[#161F30] border border-[#E6EBF2] dark:border-[#243147] overflow-hidden">
          <div className="px-5 py-3.5 border-b border-[#E6EBF2] dark:border-[#243147] flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="font-display text-sm font-semibold font-mono text-[#172033] dark:text-[#F1F5F9]">
                {selected ? `${selected.schema}.${selected.name}` : 'New procedure'}
              </h2>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                CREATE / CREATE OR ALTER / ALTER PROCEDURE
              </p>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={formatScript}
                disabled={loadingDetail || !script.trim()}
                title={'Format SQL (' + modLabel + ' + Shift + F)'}
                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg border border-[#D8E1EC] dark:border-[#2C3A52] bg-white dark:bg-[#1D283B] text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-[#243147] transition-colors cursor-pointer whitespace-nowrap disabled:opacity-50"
              >
                <AlignLeft className="h-3.5 w-3.5" />
                <span>Format</span>
              </button>
              <ExportMenu
                tourId="procedure-export"
                label="Export results"
                variant="secondary"
                disabled={!result}
                onSelect={exportResult}
              />
              <button
                type="button"
                onClick={save}
                disabled={busy}
                title={`Save procedure (${modLabel} + S)`}
                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-xs font-semibold text-white transition-colors cursor-pointer whitespace-nowrap disabled:opacity-50"
              >
                <Save className="h-3.5 w-3.5" />
                <span>Save</span>
              </button>
            </div>
          </div>

          {loadingDetail ? (
            <div aria-busy="true" aria-label="Loading procedure definition" className="p-4 space-y-3 bg-[#FAFBFD] dark:bg-[#111927] animate-pulse">
              <div className="h-3.5 w-64 rounded bg-slate-200 dark:bg-slate-700" />
              <div className="h-3.5 w-48 rounded bg-slate-200/80 dark:bg-slate-700/70" />
              <div className="h-3.5 w-80 max-w-full rounded bg-slate-100 dark:bg-slate-800" />
              <div className="h-3.5 w-72 max-w-full rounded bg-slate-200/80 dark:bg-slate-700/70" />
              <div className="h-3.5 w-56 rounded bg-slate-100 dark:bg-slate-800" />
              <div className="h-3.5 w-40 rounded bg-slate-200/80 dark:bg-slate-700/70" />
            </div>
          ) : (
            <SqlEditor value={script} onChange={setScript} />
          )}

          {/* Integrated Execute Section */}
          {selected && loadingDetail && (
            <div className="border-t border-[#E6EBF2] dark:border-[#243147] p-5 space-y-4 animate-pulse">
              <div className="flex items-center justify-between gap-3">
                <div className="space-y-1.5">
                  <div className="h-4 w-24 rounded bg-slate-200 dark:bg-slate-700" />
                  <div className="h-3 w-56 rounded bg-slate-100 dark:bg-slate-800" />
                </div>
                <div className="h-8 w-24 rounded-lg bg-slate-200 dark:bg-slate-700" />
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="h-9 rounded-lg bg-slate-100 dark:bg-slate-800" />
                <div className="h-9 rounded-lg bg-slate-100 dark:bg-slate-800" />
              </div>
            </div>
          )}

          {selected && detail && !loadingDetail && (
            <div className="border-t border-[#E6EBF2] dark:border-[#243147] p-5 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h3 className="font-display text-sm font-semibold text-[#172033] dark:text-[#F1F5F9]">
                    Execute
                  </h3>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                    Leave a parameter empty for its default, or type{' '}
                    <code className="font-mono">null</code> for NULL.
                  </p>
                </div>

                <button
                  type="button"
                  onClick={run}
                  disabled={busy}
                  title={`Execute procedure (${modLabel} + Enter)`}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-xs font-semibold text-white transition-colors cursor-pointer whitespace-nowrap disabled:opacity-50"
                >
                  <Play className="h-3.5 w-3.5 fill-current" />
                  <span>Execute</span>
                </button>
              </div>

              {detail.parameters.length > 0 && (
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <select
                    value=""
                    aria-label="Saved parameter sets"
                    onChange={(e) => {
                      const ps = paramSets.find((x) => String(x.id) === e.target.value);
                      if (!ps) return;
                      const v: Record<string, string> = {};
                      for (const [k, val] of Object.entries(ps.parameters)) v[k] = val === null ? 'null' : String(val);
                      setValues(v);
                    }}
                    className="rounded-lg border border-[#D8E1EC] dark:border-[#2C3A52] bg-white dark:bg-[#1D283B] px-2.5 py-1.5 text-xs text-slate-700 dark:text-slate-200"
                  >
                    <option value="">{paramSets.length ? 'Load saved parameters…' : 'No saved parameter sets'}</option>
                    {paramSets.map((ps) => (
                      <option key={ps.id} value={ps.id}>
                        {ps.label}
                      </option>
                    ))}
                  </select>
                  {savingSet ? (
                    <>
                      <input
                        autoFocus
                        value={setLabel}
                        onChange={(e) => setSetLabel(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') void saveParamSet();
                          if (e.key === 'Escape') setSavingSet(false);
                        }}
                        placeholder="Name this set"
                        maxLength={100}
                        className="rounded-lg border border-[#D8E1EC] dark:border-[#2C3A52] bg-white dark:bg-[#1D283B] px-2.5 py-1.5 text-xs"
                      />
                      <button
                        type="button"
                        onClick={() => void saveParamSet()}
                        disabled={!setLabel.trim()}
                        className="cursor-pointer rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
                      >
                        Save
                      </button>
                      <button type="button" onClick={() => setSavingSet(false)} className="cursor-pointer px-2 py-1.5 text-xs text-slate-500">
                        Cancel
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setSavingSet(true)}
                      className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-[#D8E1EC] dark:border-[#2C3A52] px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-[#1D283B]"
                    >
                      <BookmarkPlus className="h-3.5 w-3.5" />
                      Save these values
                    </button>
                  )}
                  {paramSets.length > 0 && (
                    <details className="relative">
                      <summary className="cursor-pointer list-none px-2 py-1.5 text-xs text-slate-500 hover:text-slate-700 dark:hover:text-slate-200">
                        Manage
                      </summary>
                      <ul className="absolute z-10 mt-1 w-56 rounded-lg border border-[#D8E1EC] dark:border-[#2C3A52] bg-white dark:bg-[#161F30] p-1 shadow-lg">
                        {paramSets.map((ps) => (
                          <li key={ps.id} className="flex items-center justify-between gap-2 rounded px-2 py-1.5 hover:bg-slate-50 dark:hover:bg-[#1D283B]">
                            <span className="truncate">{ps.label}</span>
                            <button
                              type="button"
                              onClick={() => void removeParamSet(ps.id)}
                              aria-label={`Remove saved parameter set ${ps.label}`}
                              className="cursor-pointer text-slate-400 hover:text-rose-600"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </li>
                        ))}
                      </ul>
                    </details>
                  )}
                </div>
              )}

              {detail.parameters.length > 0 && (
                <div className="grid gap-3 sm:grid-cols-2">
                  {detail.parameters.map((p) => (
                    <Field
                      key={p.name}
                      label={`${p.name} · ${p.type}${p.isOutput ? ' · OUTPUT' : ''}${
                        p.hasDefault ? ' · optional' : ''
                      }`}
                    >
                      <input
                        value={values[p.name] ?? ''}
                        onChange={(e) =>
                          setValues((v) => ({ ...v, [p.name]: e.target.value }))
                        }
                        placeholder={
                          p.hasDefault ? '(default)' : p.isOutput ? '(output)' : ''
                        }
                        className={`${inputClass} font-mono text-xs`}
                      />
                    </Field>
                  ))}
                </div>
              )}

              {executing ? (
                <div className="pt-2 border-t border-[#E2E8F0] dark:border-[#243147] space-y-3">
                  <div className="flex items-center justify-between animate-pulse">
                    <div className="h-8 w-44 rounded-lg bg-slate-200/80 dark:bg-slate-700/70" />
                    <div className="h-3.5 w-36 rounded bg-slate-100 dark:bg-slate-800" />
                  </div>
                  <DataGridSkeleton columns={4} rows={4} />
                </div>
              ) : (
                <AnimatePresence>
                  {result && (
                    <motion.div
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -6 }}
                      transition={{ duration: 0.2, ease: 'easeOut' }}
                    >
                      <ExecutionView result={result} procedureName={selected.name} />
                    </motion.div>
                  )}
                </AnimatePresence>
              )}

              <div className="pt-3 border-t border-[#E2E8F0] dark:border-[#243147]">
                <button
                  type="button"
                  onClick={() => setHistoryOpen((o) => !o)}
                  aria-expanded={historyOpen}
                  className="inline-flex cursor-pointer items-center gap-1.5 text-xs font-semibold text-slate-600 dark:text-slate-300"
                >
                  {historyOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                  <History className="h-3.5 w-3.5" />
                  Run history ({history.length})
                </button>
                {historyOpen && (
                  <ul className="mt-2 divide-y divide-[#EEF2F7] dark:divide-[#243147] rounded-lg border border-[#E6EBF2] dark:border-[#243147]">
                    {history.length === 0 && (
                      <li className="px-3 py-4 text-center text-xs text-slate-500 dark:text-slate-400">
                        No runs recorded for this procedure yet.
                      </li>
                    )}
                    {history.map((h) => (
                      <li key={h.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-xs">
                        <span
                          className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${
                            h.status === 'success'
                              ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300'
                              : 'bg-rose-50 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300'
                          }`}
                        >
                          {h.status}
                        </span>
                        <span className="tabular-nums text-slate-500 dark:text-slate-400">
                          {new Date(h.createdAt).toLocaleString()}
                        </span>
                        {h.status === 'success' ? (
                          <span className="tabular-nums text-slate-400">{h.elapsedMs} ms</span>
                        ) : (
                          <span className="min-w-0 flex-1 truncate text-rose-600 dark:text-rose-400" title={h.error ?? ''}>
                            {h.error}
                          </span>
                        )}
                        <button
                          type="button"
                          onClick={() => void loadHistoryEntry(h.id)}
                          className="ml-auto cursor-pointer rounded-md border border-[#D8E1EC] dark:border-[#2C3A52] px-2 py-1 text-[11px] font-medium text-slate-600 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-[#1D283B]"
                        >
                          Load values{h.status === 'success' ? ' & result' : ''}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
