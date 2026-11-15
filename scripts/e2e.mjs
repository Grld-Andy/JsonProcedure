// Launches the built app with a throwaway profile and drives it over the DevTools protocol.
//   npm run build && ELECTRON_RUN_AS_NODE=1 node_modules/electron/dist/electron.exe scripts/e2e.mjs [screenshot.png]
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const exe = path.join(root, 'node_modules/electron/dist/electron.exe');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-e2e-'));
const port = 9333;
const shot = process.argv[2];

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE; // we are running under it; the child must be a real Electron
// APP_EXE=release/win-unpacked/JsonProcedure.exe tests the packaged app instead of the built sources.
const packaged = process.env.APP_EXE ? path.resolve(process.env.APP_EXE) : null;
const flags = [`--remote-debugging-port=${port}`, `--user-data-dir=${profile}`];
const child = spawn(packaged ?? exe, packaged ? flags : [root, ...flags], { env, stdio: 'ignore' });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const problems = [];
let exitCode = 0;
try {
  let target;
  for (let i = 0; i < 60 && !target; i++) {
    await sleep(500);
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
      target = list.find((t) => t.type === 'page');
    } catch { /* not up yet */ }
  }
  if (!target) throw new Error('The app window did not appear.');

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0;
  const pending = new Map();
  ws.onmessage = (m) => {
    const d = JSON.parse(m.data);
    if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); }
    if (d.method === 'Runtime.exceptionThrown') problems.push('exception: ' + (d.params.exceptionDetails.exception?.description ?? d.params.exceptionDetails.text));
    if (d.method === 'Runtime.consoleAPICalled' && d.params.type === 'error')
      problems.push('console.error: ' + d.params.args.map((a) => a.value ?? a.description).join(' '));
    if (d.method === 'Log.entryAdded' && d.params.entry.level === 'error') problems.push('log: ' + d.params.entry.text + ' ' + (d.params.entry.url ?? ''));
  };
  const send = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
  const evaluate = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.result.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description ?? 'evaluate failed');
    return r.result.result.value;
  };
  await send('Runtime.enable');
  await send('Log.enable');
  await send('Page.enable');
  await sleep(2500); // let the UI mount and run its start-up requests

  const check = (name, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? ' - ' + extra : ''}`); if (!ok) exitCode = 1; };

  check('page title', (await evaluate('document.title')).includes('JsonProcedure'));
  check('bridge exposed, no Node leaked', await evaluate("typeof window.jp?.request === 'function' && typeof window.require === 'undefined' && typeof window.process === 'undefined'"));
  const conn = await evaluate("window.jp.request('GET','/api/connection')");
  check('GET /api/connection over IPC', conn.status === 200 && 'connected' in conn.body, JSON.stringify(conn.body).slice(0, 90));
  const put = await evaluate("window.jp.request('PUT','/api/settings',{e2e:{ok:true}})");
  check('PUT /api/settings persists', put.status === 200 && put.body.e2e?.ok === true);
  const bad = await evaluate("window.jp.request('GET','/api/tables')");
  check('no connection -> 503 with message', bad.status === 503 && /No database connection/.test(bad.body.error), bad.body.error);
  const nf = await evaluate("window.jp.request('GET','/etc/passwd')");
  check('non-/api paths rejected', nf.status === 400);
  const drv = await evaluate("window.jp.request('POST','/api/connection/test',{server:'127.0.0.1',port:1,authType:'sql',user:'sa',password:'x',database:'d'})");
  check('SQL driver loads and reports a closed port cleanly', drv.status === 200 && drv.body.serverReachable === false && !!drv.body.error, String(drv.body.error).slice(0, 70));
  const text = await evaluate('document.body.innerText');
  check('UI rendered', /Database Connection/.test(text), text.replace(/\s+/g, ' ').slice(0, 110));
  check('no simulation UI', !/simulation/i.test(text));
  const logs = await evaluate("window.jp.request('GET','/api/logs?limit=5')");
  check('activity log recorded requests', logs.status === 200 && logs.body.items.length > 0, `${logs.body.items.length} entries`);

  if (shot) {
    const r = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(shot, Buffer.from(r.result.data, 'base64'));
    console.log('screenshot ->', shot);
  }
  check('no renderer errors', problems.length === 0, problems.join(' | ').slice(0, 400));
  ws.close();
} catch (e) {
  console.log('FAIL  ' + e.message);
  exitCode = 1;
} finally {
  child.kill();
  await sleep(800);
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* still releasing files */ }
}
process.exit(exitCode);
