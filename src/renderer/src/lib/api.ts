import type { DatabaseEngine } from '../components/DatabaseIcons';

export type Json = unknown;

export interface ForeignKeyRef {
  schema?: string;
  table: string;
  column: string;
}

export interface ColumnDef {
  name: string;
  type: string;
  length?: string | null;
  precision?: number | null;
  scale?: number | null;
  nullable: boolean;
  primaryKey: boolean;
  identity: boolean;
  unique: boolean;
  default?: string | null;
  check?: string | null;
  references?: ForeignKeyRef | null;
}

export interface TableColumnInfo {
  name: string;
  type: string;
  nullable: boolean;
  primaryKey: boolean;
  identity: boolean;
  unique: boolean;
  computed: boolean;
  default: string | null;
  references: string | null;
}

export interface TableInfo {
  schema: string;
  name: string;
  rowCount: number;
  columns: TableColumnInfo[];
}

export interface ProcedureSummary {
  schema: string;
  name: string;
  created: string;
  modified: string;
  parameterCount: number;
}

export interface ProcedureParameter {
  name: string;
  type: string;
  isOutput: boolean;
  hasDefault: boolean;
}

export interface ProcedureDetail {
  schema: string;
  name: string;
  definition: string | null;
  isEncrypted: boolean;
  parameters: ProcedureParameter[];
}

export interface ResultSet {
  columns: string[];
  rows: Record<string, unknown>[];
  json: Json | null;
}

export interface ExecutionResult {
  resultSets: ResultSet[];
  outputParameters: Record<string, unknown>;
  returnValue: number | null;
  rowsAffected: number;
  elapsedMs: number;
}

/** Sends a request to the backend in the Electron main process (same paths and JSON as the old HTTP API). */
export async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  const bridge = window.jp;
  if (!bridge) {
    throw new Error('The desktop backend is not available. Run JsonProcedure as the desktop app.');
  }
  const res = await bridge.request(method, url, body);
  if (res.status >= 400) {
    const err = (res.body as { error?: string } | null)?.error;
    throw new Error(err || `Request failed (${res.status})`);
  }
  if (res.status === 204) return undefined as T;
  return res.body as T;
}

const enc = encodeURIComponent;

export const api = {
  tables: () => request<TableInfo[]>('GET', '/api/tables'),

  previewTable: (t: { schema?: string; name: string; columns: ColumnDef[] }) =>
    request<{ sql: string }>('POST', '/api/tables/preview', t),

  createTable: (t: { schema?: string; name: string; columns: ColumnDef[] }) =>
    request<{ sql: string }>('POST', '/api/tables', t),

  infer: (rows: Record<string, unknown>[]) => request<ColumnDef[]>('POST', '/api/tables/infer', { rows }),

  dropTable: (s: string, n: string) => request<void>('DELETE', `/api/tables/${enc(s)}/${enc(n)}`),

  rows: (s: string, n: string, top = 100) =>
    request<ResultSet>('GET', `/api/tables/${enc(s)}/${enc(n)}/rows?top=${top}`),

  insertRow: (s: string, n: string, values: Record<string, unknown>) =>
    request<{ inserted: number }>('POST', `/api/tables/${enc(s)}/${enc(n)}/rows`, { values }),

  importRows: (s: string, n: string, rows: Record<string, unknown>[]) =>
    request<{ inserted: number }>('POST', `/api/tables/${enc(s)}/${enc(n)}/import`, { rows }),

  procedures: () => request<ProcedureSummary[]>('GET', '/api/procedures'),

  procedure: (s: string, n: string) => request<ProcedureDetail>('GET', `/api/procedures/${enc(s)}/${enc(n)}`),

  saveProcedure: (script: string) => request<{ saved: boolean }>('POST', '/api/procedures', { script }),

  dropProcedure: (s: string, n: string) => request<void>('DELETE', `/api/procedures/${enc(s)}/${enc(n)}`),

  // The backend records every run (success or failure) in the execution history.
  execute: (s: string, n: string, parameters: Record<string, unknown>) =>
    request<ExecutionResult>('POST', `/api/procedures/${enc(s)}/${enc(n)}/execute`, { parameters }),
};

/** Combine result sets into a single JSON value (one set -> array of rows, many -> array of arrays). */
export function resultToJson(r: ExecutionResult): Json {
  const sets = r.resultSets.map((s) => (s.json !== null && s.json !== undefined ? s.json : s.rows));
  const body = sets.length === 1 ? sets[0] : sets;
  const hasExtras = Object.keys(r.outputParameters).length > 0 || r.returnValue !== null;
  return hasExtras ? { results: body, outputParameters: r.outputParameters, returnValue: r.returnValue } : body;
}

// ---- connection -----------------------------------------------------------
export interface ConnectionStatus {
  connected: boolean;
  error: string | null;
  dbType?: DatabaseEngine;
  server: string | null;
  database: string | null;
  authType: 'windows' | 'sql';
  user: string | null;
  hasPassword: boolean;
  trustServerCertificate: boolean;
  encrypt: boolean;
  connectionString: string;
}

export interface ConnectionSettings {
  dbType?: DatabaseEngine;
  connectionString?: string;
  server?: string;
  port?: number;
  database?: string;
  authType?: 'windows' | 'sql';
  user?: string;
  password?: string;
  trustServerCertificate?: boolean;
  encrypt?: boolean;
  createDatabase?: boolean;
}

export const connectionApi = {
  status: () => request<ConnectionStatus>('GET', '/api/connection'),

  test: (s: ConnectionSettings) =>
    request<{ serverReachable: boolean; databaseExists: boolean; error: string | null }>('POST', '/api/connection/test', s),

  apply: (s: ConnectionSettings) => request<ConnectionStatus>('PUT', '/api/connection', s),
};

// ---- export (JSON / CSV / Excel) -------------------------------------------
export type ExportFormat = 'json' | 'csv' | 'xlsx';

export const EXPORT_FORMATS: { id: ExportFormat; label: string; ext: string; hint: string }[] = [
  { id: 'json', label: 'JSON', ext: 'json', hint: 'Formatted .json file' },
  { id: 'csv', label: 'CSV', ext: 'csv', hint: 'Comma-separated, opens in Excel' },
  { id: 'xlsx', label: 'Excel', ext: 'xlsx', hint: 'Excel workbook (.xlsx)' },
];

export interface ExportSheet {
  name: string;
  columns: string[];
  rows: Record<string, unknown>[];
}

export function sheetFromRecords(
  name: string,
  rows: Record<string, unknown>[],
  columns?: string[]
): ExportSheet {
  let cols = columns && columns.length ? columns : [];
  if (!cols.length) {
    const seen = new Set<string>();
    for (const r of rows) for (const k of Object.keys(r)) seen.add(k);
    cols = [...seen];
  }
  return { name, columns: cols, rows };
}

/** Turn a procedure result into one sheet per result set (plus output parameters). */
export function resultToSheets(r: ExecutionResult): ExportSheet[] {
  const many = r.resultSets.length > 1;
  const sheets = r.resultSets.map((s, i) => {
    const name = many ? 'Result ' + (i + 1) : 'Result';
    const fromJson =
      Array.isArray(s.json) &&
      s.json.length > 0 &&
      s.json.every((x) => x && typeof x === 'object' && !Array.isArray(x));
    return fromJson
      ? sheetFromRecords(name, s.json as Record<string, unknown>[])
      : sheetFromRecords(name, s.rows, s.columns);
  });
  const extras: Record<string, unknown>[] = [];
  if (r.returnValue !== null) extras.push({ Name: '(return value)', Value: r.returnValue });
  for (const [Name, Value] of Object.entries(r.outputParameters)) extras.push({ Name, Value });
  if (extras.length) sheets.push({ name: 'Output parameters', columns: ['Name', 'Value'], rows: extras });
  return sheets;
}

function cellText(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'string') return v;
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

function csvCell(v: unknown): string {
  const s = cellText(v);
  return /[",\r\n]/.test(s) || s !== s.trim() ? '"' + s.replace(/"/g, '""') + '"' : s;
}

export function sheetToCsv(sheet: ExportSheet): string {
  const lines = [sheet.columns.map(csvCell).join(',')];
  for (const r of sheet.rows) lines.push(sheet.columns.map((c) => csvCell(r[c])).join(','));
  return lines.join('\r\n');
}

export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ---- minimal .xlsx writer (no dependencies) ---------------------------------
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function concatBytes(parts: Uint8Array[]): Uint8Array {
  let n = 0;
  for (const p of parts) n += p.length;
  const out = new Uint8Array(n);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

/** Stores files uncompressed in a ZIP container. */
function zipStore(files: { name: string; data: Uint8Array }[]): Uint8Array {
  const enc = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const f of files) {
    const name = enc.encode(f.name);
    const crc = crc32(f.data);
    const size = f.data.length;
    const lh = new Uint8Array(30 + name.length);
    const v = new DataView(lh.buffer);
    v.setUint32(0, 0x04034b50, true);
    v.setUint16(4, 20, true);
    v.setUint16(6, 0x0800, true);
    v.setUint16(12, 0x21, true);
    v.setUint32(14, crc, true);
    v.setUint32(18, size, true);
    v.setUint32(22, size, true);
    v.setUint16(26, name.length, true);
    lh.set(name, 30);
    chunks.push(lh, f.data);
    const ch = new Uint8Array(46 + name.length);
    const c = new DataView(ch.buffer);
    c.setUint32(0, 0x02014b50, true);
    c.setUint16(4, 20, true);
    c.setUint16(6, 20, true);
    c.setUint16(8, 0x0800, true);
    c.setUint16(14, 0x21, true);
    c.setUint32(16, crc, true);
    c.setUint32(20, size, true);
    c.setUint32(24, size, true);
    c.setUint16(28, name.length, true);
    c.setUint32(42, offset, true);
    ch.set(name, 46);
    central.push(ch);
    offset += lh.length + size;
  }
  const cdSize = central.reduce((a, c) => a + c.length, 0);
  const end = new Uint8Array(22);
  const e = new DataView(end.buffer);
  e.setUint32(0, 0x06054b50, true);
  e.setUint16(8, files.length, true);
  e.setUint16(10, files.length, true);
  e.setUint32(12, cdSize, true);
  e.setUint32(16, offset, true);
  return concatBytes([...chunks, ...central, end]);
}

function xmlEscape(s: string): string {
  return s
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function colLetter(index: number): string {
  let n = index + 1;
  let s = '';
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

function uniqueSheetName(raw: string, used: Set<string>): string {
  const base = raw.replace(/[\[\]:*?\/\\]/g, '_').slice(0, 31) || 'Sheet';
  let name = base;
  let i = 2;
  while (used.has(name.toLowerCase())) {
    const suffix = ' (' + i++ + ')';
    name = base.slice(0, 31 - suffix.length) + suffix;
  }
  used.add(name.toLowerCase());
  return name;
}

function worksheetXml(sheet: ExportSheet): string {
  const widths = sheet.columns.map((c) => {
    let w = c.length;
    for (const r of sheet.rows.slice(0, 200)) w = Math.max(w, cellText(r[c]).length);
    return Math.min(60, Math.max(10, w + 2));
  });
  const rows: string[] = [];
  rows.push(
    '<row r="1">' +
      sheet.columns
        .map(
          (c, ci) =>
            '<c r="' + colLetter(ci) + '1" s="1" t="inlineStr"><is><t xml:space="preserve">' +
            xmlEscape(c) + '</t></is></c>'
        )
        .join('') +
      '</row>'
  );
  sheet.rows.forEach((r, ri) => {
    const cells = sheet.columns
      .map((c, ci) => {
        const v = r[c];
        const ref = colLetter(ci) + (ri + 2);
        if (v === null || v === undefined || v === '') return '';
        if (typeof v === 'number' && Number.isFinite(v)) return '<c r="' + ref + '"><v>' + v + '</v></c>';
        if (typeof v === 'boolean') return '<c r="' + ref + '" t="b"><v>' + (v ? 1 : 0) + '</v></c>';
        return (
          '<c r="' + ref + '" t="inlineStr"><is><t xml:space="preserve">' +
          xmlEscape(cellText(v).slice(0, 32767)) + '</t></is></c>'
        );
      })
      .join('');
    rows.push('<row r="' + (ri + 2) + '">' + cells + '</row>');
  });
  const cols = widths.length
    ? '<cols>' + widths.map((w, i) => '<col min="' + (i + 1) + '" max="' + (i + 1) + '" width="' + w + '" customWidth="1"/>').join('') + '</cols>'
    : '';
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>' +
    cols + '<sheetData>' + rows.join('') + '</sheetData></worksheet>'
  );
}

function buildXlsx(sheets: ExportSheet[]): Uint8Array {
  const enc = new TextEncoder();
  const used = new Set<string>();
  const names = sheets.map((s) => uniqueSheetName(s.name, used));
  const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
  const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  const PKG = 'http://schemas.openxmlformats.org/package/2006/relationships';
  const files: { name: string; text: string }[] = [
    {
      name: '[Content_Types].xml',
      text:
        XML +
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
        '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
        sheets
          .map((_, i) => '<Override PartName="/xl/worksheets/sheet' + (i + 1) + '.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>')
          .join('') +
        '</Types>',
    },
    {
      name: '_rels/.rels',
      text: XML + '<Relationships xmlns="' + PKG + '"><Relationship Id="rId1" Type="' + REL + '/officeDocument" Target="xl/workbook.xml"/></Relationships>',
    },
    {
      name: 'xl/workbook.xml',
      text:
        XML +
        '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="' + REL + '"><sheets>' +
        names.map((n, i) => '<sheet name="' + xmlEscape(n) + '" sheetId="' + (i + 1) + '" r:id="rId' + (i + 1) + '"/>').join('') +
        '</sheets></workbook>',
    },
    {
      name: 'xl/_rels/workbook.xml.rels',
      text:
        XML + '<Relationships xmlns="' + PKG + '">' +
        sheets.map((_, i) => '<Relationship Id="rId' + (i + 1) + '" Type="' + REL + '/worksheet" Target="worksheets/sheet' + (i + 1) + '.xml"/>').join('') +
        '<Relationship Id="rId' + (sheets.length + 1) + '" Type="' + REL + '/styles" Target="styles.xml"/></Relationships>',
    },
    {
      name: 'xl/styles.xml',
      text:
        XML +
        '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
        '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>' +
        '<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>' +
        '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
        '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
        '<cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs>' +
        '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>',
    },
    ...sheets.map((s, i) => ({ name: 'xl/worksheets/sheet' + (i + 1) + '.xml', text: worksheetXml(s) })),
  ];
  return zipStore(files.map((f) => ({ name: f.name, data: enc.encode(f.text) })));
}

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** Builds the file for the chosen format, downloads it and returns the file name. */
export function exportData(opts: {
  format: ExportFormat;
  baseName: string;
  sheets: ExportSheet[];
  json?: Json;
}): string {
  const meta = EXPORT_FORMATS.find((f) => f.id === opts.format) ?? EXPORT_FORMATS[0];
  const fileName = opts.baseName.replace(/[\\/:*?"<>|]+/g, '_') + '.' + meta.ext;
  const sheets: ExportSheet[] = opts.sheets.length
    ? opts.sheets
    : [{ name: 'Sheet1', columns: [], rows: [] }];
  let blob: Blob;
  if (meta.id === 'csv') {
    blob = new Blob(['﻿' + sheets.map(sheetToCsv).join('\r\n\r\n')], { type: 'text/csv;charset=utf-8' });
  } else if (meta.id === 'xlsx') {
    blob = new Blob([buildXlsx(sheets) as unknown as BlobPart], { type: XLSX_MIME });
  } else {
    const value =
      opts.json !== undefined ? opts.json : sheets.length === 1 ? sheets[0].rows : sheets.map((s) => s.rows);
    blob = new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' });
  }
  downloadBlob(blob, fileName);
  return fileName;
}
