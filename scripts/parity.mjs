// Sends identical requests to the legacy C# API (http://127.0.0.1:5080) and to the new in-process
// backend, then diffs status + JSON. Run with Electron's Node so it matches the packaged runtime:
//   ELECTRON_RUN_AS_NODE=1 node_modules/electron/dist/electron.exe scripts/parity.mjs [cases-file]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Backend } from '../src/main/backend/index.ts';

const CS = process.env.CS_URL ?? 'http://127.0.0.1:5080';
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-parity-'));
const backend = new Backend({
  dataDir: dir,
  protector: { protect: (s) => 'x:' + Buffer.from(s).toString('base64'), unprotect: (s) => Buffer.from(s.slice(2), 'base64').toString() },
});
await backend.init();

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z?$/;
function norm(v) {
  if (Array.isArray(v)) return v.map(norm);
  if (v && typeof v === 'object') return Object.fromEntries(Object.keys(v).sort().map((k) => [k, norm(v[k])]));
  if (typeof v === 'string' && ISO.test(v)) return '<ts>';
  return v;
}

async function callCs(method, url, body) {
  const res = await fetch(CS + url, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = text; }
  return { status: res.status, body: json };
}
async function callJs(method, url, body) {
  const r = await backend.handle(method, url, body === undefined ? undefined : JSON.parse(JSON.stringify(body)));
  return { status: r.status, body: r.body === undefined ? null : JSON.parse(JSON.stringify(r.body)) };
}

const casesFile = process.argv[2] ?? './parity-cases.mjs';
const { cases, connectionHook } = await import(casesFile);
if (connectionHook) await connectionHook({ callCs, callJs });

let ok = 0;
let bad = 0;
const known = [];
for (const c of cases) {
  const [method, url, body, opts = {}] = c;
  const [a, b] = [await callCs(method, url, body), await callJs(method, url, body)];
  const sa = JSON.stringify(norm(opts.ignoreBody ? { status: a.status } : a));
  const sb = JSON.stringify(norm(opts.ignoreBody ? { status: b.status } : b));
  if (sa === sb) { ok++; if (process.env.VERBOSE) console.log('ok  ', method, url); continue; }
  if (opts.known) { known.push([method, url, opts.known]); continue; }
  bad++;
  console.log(`\nDIFF ${method} ${url}${body !== undefined ? ' ' + JSON.stringify(body).slice(0, 160) : ''}`);
  console.log('  C#  :', JSON.stringify(norm(a)).slice(0, 700));
  console.log('  JS  :', JSON.stringify(norm(b)).slice(0, 700));
}
console.log(`\n${ok} identical, ${bad} different, ${known.length} known/accepted differences, of ${cases.length}`);
for (const [m, u, why] of known) console.log(`  known: ${m} ${u} -- ${why}`);
await backend.dispose();
fs.rmSync(dir, { recursive: true, force: true });
process.exit(bad ? 1 : 0);
