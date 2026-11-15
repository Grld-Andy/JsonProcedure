// Unit checks for the SQL Server layer that need no server: connection strings, result-set shaping,
// value normalisation and failure paths. Run: ELECTRON_RUN_AS_NODE=1 node_modules/electron/dist/electron.exe scripts/unit-backend.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildConnectionString, connInfoFromSettings, parseConnectionString } from '../src/main/backend/connString.ts';
import { Backend } from '../src/main/backend/index.ts';
import { Db } from '../src/main/backend/db.ts';

let pass = 0;
const t = (name, fn) => {
  try { fn(); pass++; } catch (e) { console.log('FAIL', name, '\n   ', e.message.split('\n').slice(0, 4).join('\n    ')); process.exitCode = 1; }
};

// ---- connection strings -------------------------------------------------------------------------
t('parses an ADO.NET string with the keywords the old app wrote', () => {
  const c = parseConnectionString(
    'Data Source=192.168.0.61;Initial Catalog=HARD_TRY;Persist Security Info=False;User ID=sa;Password="p;w=1";Pooling=True;' +
    'Multiple Active Result Sets=False;Encrypt=True;Trust Server Certificate=True;Application Name=App;Command Timeout=60');
  assert.deepEqual([c.server, c.database, c.user, c.password, c.encrypt, c.trustServerCertificate, c.commandTimeout, c.integrated],
    ['192.168.0.61', 'HARD_TRY', 'sa', 'p;w=1', true, true, 60, false]);
});
t('server forms: port, instance, tcp:, (local)', () => {
  assert.deepEqual(parseConnectionString('Server=tcp:db.example.com,1444;Database=x').port, 1444);
  const i = parseConnectionString('Server=.\\SQLEXPRESS;Database=x');
  assert.deepEqual([i.server, i.instance], ['localhost', 'SQLEXPRESS']);
  assert.equal(parseConnectionString('Server=(local);Database=x').server, 'localhost');
});
t('defaults match SqlClient 4+ (encrypt on, no trust)', () => {
  const c = parseConnectionString('Server=h;Database=d;Trusted_Connection=yes');
  assert.deepEqual([c.encrypt, c.trustServerCertificate, c.integrated, c.user], [true, false, true, undefined]);
});
t('round trip keeps every field, masks only on request', () => {
  const src = connInfoFromSettings({ server: 'h', port: 1433, database: 'd', authType: 'sql', user: 'u', password: 'we"ird;pw', encrypt: true });
  const back = parseConnectionString(buildConnectionString(src));
  assert.equal(JSON.stringify(back), JSON.stringify(src));
  assert.ok(!buildConnectionString(src, true).includes('we"ird'));
  assert.ok(buildConnectionString(src, true).includes('Password=********'));
});
t('bad input gives 400 messages', () => {
  for (const [s, rx] of [['garbage', /keyword=value/], ['Database=x', /Data Source/], ["Server=h;Password='x", /unterminated/], ['Server=h;Encrypt=maybe', /boolean/]])
    assert.throws(() => parseConnectionString(s), (e) => e.status === 400 && rx.test(e.message), s);
  assert.throws(() => connInfoFromSettings({ server: '' }), /Server is required/);
  assert.throws(() => connInfoFromSettings({ server: 'h', authType: 'sql', user: ' ' }), /User is required/);
});

// ---- result sets --------------------------------------------------------------------------------------
const rs = (cols, rows) => Object.assign(rows, { columns: cols.map((c, i) => ({ index: i, name: c[0], type: { declaration: c[1] } })) });
t('readAll: duplicate/empty names, bigint, guid, dates, binary, null', () => {
  const sets = Db.readAll([
    rs([['a', 'int'], ['a', 'int'], ['', 'varchar'], ['big', 'bigint'], ['g', 'uniqueidentifier'], ['d', 'datetime'], ['dt', 'date'], ['o', 'datetimeoffset'], ['tm', 'time'], ['b', 'varbinary'], ['n', 'int']],
       [[1, 2, 'x', '9007199254740993', 'AAAA-BBBB', new Date('2024-05-06T07:08:09.120Z'), new Date('2024-05-06T00:00:00Z'), new Date('2024-05-06T07:08:09Z'), new Date('1970-01-01T10:30:00Z'), Buffer.from([1, 2, 3]), null]]),
  ]);
  assert.deepEqual(sets[0].columns, ['a', 'a_2', 'Column3', 'big', 'g', 'd', 'dt', 'o', 'tm', 'b', 'n']);
  assert.deepEqual(sets[0].rows[0], {
    a: 1, a_2: 2, Column3: 'x', big: '9007199254740993', g: 'aaaa-bbbb', d: '2024-05-06T07:08:09.12', dt: '2024-05-06T00:00:00',
    o: '2024-05-06T07:08:09.000Z', tm: '10:30:00', b: 'AQID', n: null,
  });
});
t('readAll: bigint in safe range becomes a number', () => {
  assert.equal(Db.readAll([rs([['x', 'bigint']], [['42']])])[0].rows[0].x, 42);
});
t('readAll: FOR JSON arrives as one object row and is parsed', () => {
  const name = 'JSON_F52E2B61-18A1-11d1-B105-00805F49916B';
  const sets = Db.readAll([rs([[name, 'nvarchar']], [{ [name]: '[{"a":1},{"a":2}]' }])]);
  assert.deepEqual(sets, [{ columns: ['JSON'], rows: [], json: [{ a: 1 }, { a: 2 }] }]);
  assert.equal(Db.readAll([rs([[name, 'nvarchar']], [{ [name]: '' }])])[0].json, null);
  assert.equal(Db.readAll([rs([[name, 'nvarchar']], [{ [name]: '{broken' }])])[0].json, null);
});
t('readAll: empty result set keeps its columns; sets without columns are skipped', () => {
  const sets = Db.readAll([rs([['a', 'int']], []), Object.assign([], { columns: [] })]);
  assert.deepEqual(sets, [{ columns: ['a'], rows: [], json: null }]);
});
t('fromJson: scalars pass through, objects are stored as text', () => {
  assert.deepEqual([Db.fromJson(1), Db.fromJson('x'), Db.fromJson(true), Db.fromJson(null), Db.fromJson({ a: 1 })], [1, 'x', true, null, '{"a":1}']);
});
t('identifier quoting', () => {
  assert.equal(Db.full(null, 'a]b'), '[dbo].[a]]b]');
  assert.throws(() => Db.validateIdent('1x', 'table name'), /Invalid table name/);
});

// ---- failure paths against a closed port (no server needed) -----------------------------------------
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-unit-'));
const b = new Backend({ dataDir: dir, protector: { protect: (s) => 'x:' + s, unprotect: (s) => s.slice(2) } });
await b.init();
const closed = { server: '127.0.0.1', port: 1, authType: 'sql', user: 'sa', password: 'x', database: 'd', connectionString: undefined };
let r = await b.handle('POST', '/api/connection/test', closed);
t('test() on a closed port reports unreachable, not a crash', () => {
  assert.equal(r.status, 200);
  assert.equal(r.body.serverReachable, false);
  assert.ok(r.body.error);
});
r = await b.handle('PUT', '/api/connection', closed);
t('apply() on a closed port -> 400 "Cannot connect"', () => assert.ok(r.status === 400 && /^Cannot connect: /.test(r.body.error), JSON.stringify(r)));
r = await b.handle('GET', '/api/connection');
t('a failed apply leaves the app unconfigured', () => assert.equal(r.body.connected, false));
r = await b.handle('POST', '/api/connection/test', { server: 'h', authType: 'windows' });
t('Windows auth gives a clear 400 instead of a crash', () => assert.ok(r.status === 400 && /Windows authentication/.test(r.body.error), JSON.stringify(r)));
await b.dispose();
fs.rmSync(dir, { recursive: true, force: true });
console.log(`${pass} unit checks passed${process.exitCode ? ', some FAILED' : ''}`);
