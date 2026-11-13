import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, BookmarkPlus, CheckCircle2, Pencil, Plug, Trash2 } from 'lucide-react';
import {
  DATABASE_ENGINES,
  DatabaseBrandIcon,
  type DatabaseEngine,
  getDatabaseEngineMeta,
} from '../components/DatabaseIcons';
import { connectionApi, type ConnectionSettings, type ConnectionStatus } from '../lib/api';
import { errMsg, Field, inputClass, selectClass } from '../components/shared';
import { savedConnectionsApi, type SavedConnection } from '../lib/userData';

export function ConnectionPage({
  status,
  loading = false,
  onChanged,
  onNotify,
}: {
  status: ConnectionStatus | null;
  loading?: boolean;
  onChanged: () => void;
  onNotify: (msg: string, tone?: 'success' | 'error') => void;
}) {
  const [dbType, setDbType] = useState<DatabaseEngine>(status?.dbType ?? 'sqlserver');
  const [mode, setMode] = useState<'form' | 'string'>('form');
  const [server, setServer] = useState(
    status?.server && status.connected ? status.server : 'localhost'
  );
  const [port, setPort] = useState('');
  const [database, setDatabase] = useState(status?.database || 'JsonProcedure');
  const [authType, setAuthType] = useState<'windows' | 'sql'>(status?.authType ?? 'windows');
  const [user, setUser] = useState(status?.user ?? '');
  const [password, setPassword] = useState('');
  const [trust, setTrust] = useState(true);
  const [encrypt, setEncrypt] = useState(false);
  const [raw, setRaw] = useState(
    status?.connectionString ||
      getDatabaseEngineMeta(status?.dbType ?? 'sqlserver').sampleConnectionString
  );
  const [createDb, setCreateDb] = useState(true);
  const [busy, setBusy] = useState(false);
  const [testMsg, setTestMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const engineMeta = getDatabaseEngineMeta(dbType);

  const [saved, setSaved] = useState<SavedConnection[]>([]);
  const [saveName, setSaveName] = useState('');
  const [namingSave, setNamingSave] = useState(false);

  const loadSaved = async () => {
    try {
      setSaved(await savedConnectionsApi.list());
    } catch {
      setSaved([]);
    }
  };

  useEffect(() => {
    void loadSaved();
  }, []);

  const saveForLater = async () => {
    const name = saveName.trim();
    if (!name) return;
    setBusy(true);
    try {
      const { createDatabase: _c, ...rest } = settings();
      await savedConnectionsApi.save({ ...rest, name });
      onNotify(`Saved connection "${name}"`, 'success');
      setSaveName('');
      setNamingSave(false);
      await loadSaved();
    } catch (e) {
      onNotify(errMsg(e), 'error');
    } finally {
      setBusy(false);
    }
  };

  const useSaved = async (c: SavedConnection) => {
    setBusy(true);
    try {
      await savedConnectionsApi.apply(c.id, createDb);
      onNotify(`Connected to "${c.name}"`, 'success');
      setTestMsg(null);
      onChanged();
    } catch (e) {
      onNotify(errMsg(e), 'error');
    } finally {
      setBusy(false);
    }
  };

  /** Loads a saved connection into the form for editing. Stored secrets are never sent back. */
  const editSaved = (c: SavedConnection) => {
    setDbType(c.dbType as DatabaseEngine);
    setTestMsg(null);
    setSaveName(c.name);
    setNamingSave(true);
    setPassword('');
    if (c.usesConnectionString) {
      setMode('string');
      setRaw('');
    } else {
      setMode('form');
      setServer(c.server ?? '');
      setPort(c.port ? String(c.port) : '');
      setDatabase(c.database ?? '');
      setAuthType(c.authType === 'sql' ? 'sql' : 'windows');
      setUser(c.user ?? '');
    }
    setTrust(c.trustServerCertificate);
    setEncrypt(c.encrypt);
    onNotify(
      c.usesConnectionString
        ? 'Paste the connection string again to change it; leave it empty to keep the saved one.'
        : 'Loaded. Leave the password empty to keep the saved one.',
      'success'
    );
  };

  const removeSaved = async (c: SavedConnection) => {
    try {
      await savedConnectionsApi.remove(c.id);
      onNotify(`Removed saved connection "${c.name}"`, 'success');
      await loadSaved();
    } catch (e) {
      onNotify(errMsg(e), 'error');
    }
  };

  const handleSelectEngine = (nextEngine: DatabaseEngine) => {
    const prevMeta = getDatabaseEngineMeta(dbType);
    const nextMeta = getDatabaseEngineMeta(nextEngine);
    setDbType(nextEngine);
    setTestMsg(null);
    if (!nextMeta.supportsWindowsAuth && authType === 'windows') {
      setAuthType('sql');
    }
    if (
      !raw.trim() ||
      raw.trim() === prevMeta.sampleConnectionString ||
      DATABASE_ENGINES.some((e) => e.sampleConnectionString === raw.trim())
    ) {
      setRaw(nextMeta.sampleConnectionString);
    }
    if (nextMeta.isFileBased) {
      if (!database || database === 'JsonProcedure') {
        setDatabase(nextMeta.dbPlaceholder);
      }
    } else if (database === prevMeta.dbPlaceholder && prevMeta.isFileBased) {
      setDatabase('JsonProcedure');
    }
    if (port && port === prevMeta.defaultPort) {
      setPort(nextMeta.defaultPort);
    }
  };

  const settings = (): ConnectionSettings =>
    mode === 'string'
      ? { dbType, connectionString: raw, createDatabase: createDb }
      : {
          dbType,
          server: engineMeta.isFileBased ? undefined : server,
          database,
          authType: engineMeta.supportsWindowsAuth ? authType : 'sql',
          user,
          password,
          port: !engineMeta.isFileBased && port ? Number(port) : undefined,
          trustServerCertificate: trust,
          encrypt,
          createDatabase: createDb,
        };

  const test = async () => {
    setBusy(true);
    setTestMsg(null);
    try {
      const r = await connectionApi.test(settings());
      if (!r.serverReachable) {
        const msg = r.error ?? 'Server unreachable';
        setTestMsg({ ok: false, text: msg });
        onNotify(msg, 'error');
      } else if (!r.databaseExists) {
        const msg =
          'Server reachable, but the database does not exist yet (it will be created when you connect).';
        setTestMsg({ ok: true, text: msg });
        onNotify('Server reachable (database will be created on connect)', 'success');
      } else {
        setTestMsg({ ok: true, text: 'Connection successful.' });
        onNotify('Connection test successful', 'success');
      }
    } catch (e) {
      const msg = errMsg(e);
      setTestMsg({ ok: false, text: msg });
      onNotify(msg, 'error');
    } finally {
      setBusy(false);
    }
  };

  const connect = async () => {
    setBusy(true);
    try {
      await connectionApi.apply(settings());
      onNotify('Connected and saved', 'success');
      setTestMsg(null);
      onChanged();
    } catch (e) {
      onNotify(errMsg(e), 'error');
    } finally {
      setBusy(false);
    }
  };

  const actionRef = useRef({
    test: () => {},
    connect: () => {},
    enabled: false,
  });

  actionRef.current = {
    test: () => void test(),
    connect: () => void connect(),
    enabled: !loading && !busy,
  };

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (document.querySelector('[role="dialog"]')) return;
      if (!actionRef.current.enabled) return;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && !e.altKey && e.key === 'Enter') {
        e.preventDefault();
        actionRef.current.connect();
      } else if (e.altKey && !mod && !e.shiftKey && e.key.toLowerCase() === 't') {
        e.preventDefault();
        actionRef.current.test();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  if (loading) {
    return (
      <div className="w-full" aria-busy="true" aria-label="Loading connection settings">
        <section className="rounded-xl bg-white dark:bg-[#161F30] border border-[#E6EBF2] dark:border-[#243147] overflow-hidden animate-pulse">
          <div className="px-6 py-4 bg-[#FAFBFD] dark:bg-[#1D283B]/50 border-b border-[#E6EBF2] dark:border-[#243147]">
            <div className="h-4 w-72 max-w-full rounded bg-slate-200 dark:bg-slate-700" />
          </div>
          <div className="p-6 space-y-5">
            <div className="h-8 w-52 rounded-lg bg-slate-200/80 dark:bg-slate-700/70" />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {[0, 1, 2, 3].map((idx) => (
                <div key={idx} className="space-y-2">
                  <div className="h-3 w-28 rounded bg-slate-200/80 dark:bg-slate-700/70" />
                  <div className="h-9 w-full rounded-lg bg-slate-100 dark:bg-slate-800" />
                </div>
              ))}
            </div>
            <div className="flex gap-6 pt-1">
              <div className="h-4 w-40 rounded bg-slate-100 dark:bg-slate-800" />
              <div className="h-4 w-20 rounded bg-slate-100 dark:bg-slate-800" />
            </div>
            <div className="h-4 w-56 rounded bg-slate-100 dark:bg-slate-800" />
            <div className="flex items-center gap-3 pt-3 border-t border-[#E6EBF2] dark:border-[#243147]">
              <div className="h-8 w-32 rounded-lg bg-slate-200/80 dark:bg-slate-700/70" />
              <div className="h-8 w-36 rounded-lg bg-slate-200 dark:bg-slate-700" />
            </div>
          </div>
        </section>
      </div>
    );
  }

  const activeEngineMeta = getDatabaseEngineMeta(status?.dbType ?? dbType);

  return (
    <div className="w-full">
      <section className="rounded-xl bg-white dark:bg-[#161F30] border border-[#E6EBF2] dark:border-[#243147] overflow-hidden">
        {/* Quiet Inline Status Strip */}
        <div className="px-6 py-4 bg-[#FAFBFD] dark:bg-[#1D283B]/50 border-b border-[#E6EBF2] dark:border-[#243147] flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-xs">
            {status?.connected ? (
              <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
            ) : (
              <AlertTriangle className="h-4 w-4 text-rose-600 dark:text-rose-400 shrink-0" />
            )}
            <span className="font-medium text-[#172033] dark:text-[#F1F5F9]">
              {status?.connected ? 'Connected' : 'Not connected'}
            </span>
            <span className="text-slate-300 dark:text-slate-600" aria-hidden="true">
              ·
            </span>
            <span className="inline-flex items-center gap-1.5 font-mono text-slate-500 dark:text-slate-400">
              <DatabaseBrandIcon
                engine={status?.dbType ?? dbType}
                className="h-4 w-4 shrink-0"
              />
              <span>{activeEngineMeta.name}</span>
              <span className="text-slate-300 dark:text-slate-600" aria-hidden="true">
                ·
              </span>
              <span>
                {status?.server
                  ? `${status.server} / ${status.database}${
                      status.dbType === 'sqlite'
                        ? ''
                        : ` (${
                            status.authType === 'sql'
                              ? `login ${status.user}`
                              : 'Windows auth'
                          })`
                    }`
                  : 'No active database session'}
              </span>
            </span>
          </div>
          {status?.error && (
            <p className="w-full text-xs text-rose-600 dark:text-rose-400">{status.error}</p>
          )}
        </div>

        {/* Form Body */}
        <div className="p-6 space-y-6">
          {/* SQL Database Type Selector */}
          <div data-tour="engine-picker" className="space-y-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <label className="text-xs font-medium text-slate-600 dark:text-slate-300">
                Database type
              </label>
              <span className="text-[11px] text-slate-500 dark:text-slate-400">
                {engineMeta.name}
                {engineMeta.defaultPort ? ` · Default port ${engineMeta.defaultPort}` : ' · Embedded file database'}
              </span>
            </div>

            <div
              role="radiogroup"
              aria-label="Database engine"
              className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5"
            >
              {DATABASE_ENGINES.map((engine) => {
                const selected = dbType === engine.id;
                return (
                  <button
                    key={engine.id}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    onClick={() => handleSelectEngine(engine.id)}
                    className={`flex items-center gap-2.5 rounded-xl border px-3 py-2.5 text-left transition-all cursor-pointer ${
                      selected
                        ? 'border-blue-600 bg-blue-50/75 dark:bg-blue-950/40 ring-2 ring-blue-500/20'
                        : 'border-[#E2E8F0] dark:border-[#2C3A52] bg-[#FAFBFD] dark:bg-[#1D283B]/60 hover:bg-white dark:hover:bg-[#1D283B] hover:border-slate-300 dark:hover:border-slate-600'
                    }`}
                  >
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white dark:bg-[#161F30] border border-[#E6EBF2] dark:border-[#243147]">
                      <DatabaseBrandIcon engine={engine.id} className="h-5 w-5" />
                    </span>
                    <span className="min-w-0">
                      <span
                        className={`block text-xs font-semibold truncate ${
                          selected
                            ? 'text-blue-900 dark:text-blue-200'
                            : 'text-[#172033] dark:text-[#E6ECF5]'
                        }`}
                      >
                        {engine.name}
                      </span>
                      <span className="block text-[10px] font-mono text-slate-500 dark:text-slate-400 truncate">
                        {engine.defaultPort ? `:${engine.defaultPort}` : 'file'}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          <div data-tour="connection-form" className="space-y-6">
          <div className="flex flex-wrap items-center justify-between gap-3 pt-1 border-t border-[#E6EBF2] dark:border-[#243147]">
            <div className="inline-flex items-center gap-1 p-1 rounded-lg bg-[#EEF2F7] dark:bg-[#1D283B]">
              <button
                type="button"
                onClick={() => setMode('form')}
                className={`px-3.5 py-1.5 rounded-md text-xs font-medium transition-colors cursor-pointer whitespace-nowrap ${
                  mode === 'form'
                    ? 'bg-white dark:bg-[#161F30] text-[#172033] dark:text-white shadow-xs'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                Details
              </button>
              <button
                type="button"
                onClick={() => setMode('string')}
                className={`px-3.5 py-1.5 rounded-md text-xs font-medium transition-colors cursor-pointer whitespace-nowrap ${
                  mode === 'string'
                    ? 'bg-white dark:bg-[#161F30] text-[#172033] dark:text-white shadow-xs'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                Connection string
              </button>
            </div>
          </div>

          {mode === 'string' ? (
            <Field label={`${engineMeta.name} connection string`}>
              <textarea
                rows={4}
                value={raw}
                onChange={(e) => setRaw(e.target.value)}
                spellCheck={false}
                placeholder={engineMeta.sampleConnectionString}
                className={`${inputClass} font-mono text-xs`}
              />
            </Field>
          ) : engineMeta.isFileBased ? (
            <div className="grid grid-cols-1 gap-4">
              <Field label="SQLite database file path">
                <input
                  value={database}
                  onChange={(e) => setDatabase(e.target.value)}
                  placeholder={engineMeta.dbPlaceholder}
                  className={`${inputClass} font-mono`}
                />
              </Field>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label="Server / host">
                <input
                  value={server}
                  onChange={(e) => setServer(e.target.value)}
                  placeholder={engineMeta.hostPlaceholder}
                  className={`${inputClass} font-mono`}
                />
              </Field>
              <Field label={`Port (optional, default ${engineMeta.defaultPort})`}>
                <input
                  value={port}
                  onChange={(e) => setPort(e.target.value.replace(/\D/g, ''))}
                  placeholder={engineMeta.defaultPort}
                  className={`${inputClass} font-mono tabular-nums`}
                />
              </Field>
              <Field label="Database name" className={engineMeta.supportsWindowsAuth ? '' : 'sm:col-span-2'}>
                <input
                  value={database}
                  onChange={(e) => setDatabase(e.target.value)}
                  placeholder={engineMeta.dbPlaceholder}
                  className={`${inputClass} font-mono`}
                />
              </Field>
              {engineMeta.supportsWindowsAuth && (
                <Field label="Authentication">
                  <select
                    value={authType}
                    onChange={(e) => setAuthType(e.target.value as 'windows' | 'sql')}
                    className={selectClass}
                  >
                    <option value="windows">Windows authentication</option>
                    <option value="sql">SQL Server login (user + password)</option>
                  </select>
                </Field>
              )}
              {(!engineMeta.supportsWindowsAuth || authType === 'sql') && (
                <>
                  <Field label="User">
                    <input
                      value={user}
                      onChange={(e) => setUser(e.target.value)}
                      placeholder={engineMeta.userPlaceholder}
                      autoComplete="off"
                      className={`${inputClass} font-mono`}
                    />
                  </Field>
                  <Field label="Password">
                    <input
                      type="password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      autoComplete="new-password"
                      className={`${inputClass} font-mono`}
                    />
                  </Field>
                </>
              )}
              <div className="sm:col-span-2 flex flex-wrap gap-6 pt-1">
                {dbType === 'sqlserver' && (
                  <label className="inline-flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={trust}
                      onChange={(e) => setTrust(e.target.checked)}
                      className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                    />
                    <span>Trust server certificate</span>
                  </label>
                )}
                <label className="inline-flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={encrypt}
                    onChange={(e) => setEncrypt(e.target.checked)}
                    className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                  />
                  <span>SSL / TLS encrypt</span>
                </label>
              </div>
            </div>
          )}

          <label className="inline-flex items-center gap-2 text-xs font-medium text-[#172033] dark:text-[#E6ECF5] cursor-pointer">
            <input
              type="checkbox"
              checked={createDb}
              onChange={(e) => setCreateDb(e.target.checked)}
              className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
            />
            <span>Create the database if it does not exist</span>
          </label>

          {testMsg && (
            <div
              className={`flex items-start gap-2.5 rounded-lg border px-3.5 py-2.5 text-xs ${
                testMsg.ok
                  ? 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-300'
                  : 'border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-300'
              }`}
            >
              {testMsg.ok ? (
                <CheckCircle2 className="h-4 w-4 shrink-0 mt-0.5" />
              ) : (
                <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
              )}
              <span>{testMsg.text}</span>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-3 pt-3 border-t border-[#E6EBF2] dark:border-[#243147]">
            <button
              type="button"
              onClick={test}
              disabled={busy}
              className="px-4 py-2 rounded-lg border border-[#D8E1EC] dark:border-[#2C3A52] bg-white dark:bg-[#1D283B] text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-[#243147] transition-colors cursor-pointer whitespace-nowrap disabled:opacity-50"
            >
              Test connection
            </button>
            <button
              type="button"
              onClick={connect}
              disabled={busy}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-xs font-semibold text-white transition-colors cursor-pointer whitespace-nowrap disabled:opacity-50"
            >
              <Plug className="h-3.5 w-3.5" />
              <span>Connect &amp; save</span>
            </button>
            {namingSave ? (
              <span className="inline-flex items-center gap-2">
                <input
                  autoFocus
                  value={saveName}
                  onChange={(e) => setSaveName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void saveForLater();
                    if (e.key === 'Escape') setNamingSave(false);
                  }}
                  placeholder="Name, e.g. Staging"
                  maxLength={100}
                  aria-label="Saved connection name"
                  className={`${inputClass} w-44`}
                />
                <button
                  type="button"
                  onClick={() => void saveForLater()}
                  disabled={busy || !saveName.trim()}
                  className="px-3 py-2 rounded-lg bg-slate-800 dark:bg-slate-200 text-xs font-semibold text-white dark:text-slate-900 cursor-pointer disabled:opacity-50"
                >
                  Save
                </button>
                <button type="button" onClick={() => setNamingSave(false)} className="px-2 py-2 text-xs text-slate-500 cursor-pointer">
                  Cancel
                </button>
              </span>
            ) : (
              <button
                type="button"
                onClick={() => setNamingSave(true)}
                disabled={busy}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg border border-[#D8E1EC] dark:border-[#2C3A52] text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-[#243147] cursor-pointer whitespace-nowrap disabled:opacity-50"
              >
                <BookmarkPlus className="h-3.5 w-3.5" />
                <span>Save for later</span>
              </button>
            )}
          </div>
          </div>
        </div>
      </section>

      <section
        aria-label="Saved connections"
        className="mt-5 rounded-xl bg-white dark:bg-[#161F30] border border-[#E6EBF2] dark:border-[#243147] overflow-hidden"
      >
        <div className="px-6 py-3.5 border-b border-[#E6EBF2] dark:border-[#243147]">
          <h2 className="font-display text-sm font-semibold text-[#172033] dark:text-[#F1F5F9]">
            Saved connections ({saved.length})
          </h2>
          <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
            Passwords are stored encrypted on the server and are never shown again. Removing an entry does not touch any database.
          </p>
        </div>
        {saved.length === 0 ? (
          <p className="px-6 py-8 text-center text-xs text-slate-500 dark:text-slate-400">
            Nothing saved yet. Fill in the form above and choose “Save for later”.
          </p>
        ) : (
          <ul className="divide-y divide-[#EEF2F7] dark:divide-[#243147]">
            {saved.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center gap-3 px-6 py-3 text-xs">
                <DatabaseBrandIcon engine={c.dbType as DatabaseEngine} className="h-4 w-4 shrink-0" />
                <span className="font-semibold text-[#172033] dark:text-[#F1F5F9]">{c.name}</span>
                <span className="min-w-0 flex-1 truncate font-mono text-slate-500 dark:text-slate-400">
                  {c.usesConnectionString
                    ? 'connection string'
                    : `${c.server ?? ''}${c.server ? ' / ' : ''}${c.database ?? ''}${
                        c.authType === 'sql' && c.user ? ` · ${c.user}` : ''
                      }`}
                </span>
                <button
                  type="button"
                  onClick={() => void useSaved(c)}
                  disabled={busy}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 font-semibold text-white hover:bg-blue-700 cursor-pointer disabled:opacity-50"
                >
                  <Plug className="h-3.5 w-3.5" />
                  Connect
                </button>
                <button
                  type="button"
                  onClick={() => editSaved(c)}
                  aria-label={`Edit saved connection ${c.name}`}
                  title="Load into the form"
                  className="rounded-lg border border-[#D8E1EC] dark:border-[#2C3A52] p-1.5 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-[#1D283B] cursor-pointer"
                >
                  <Pencil className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => void removeSaved(c)}
                  aria-label={`Remove saved connection ${c.name}`}
                  title="Remove this saved entry"
                  className="rounded-lg border border-[#D8E1EC] dark:border-[#2C3A52] p-1.5 text-slate-500 hover:text-rose-600 hover:bg-slate-50 dark:hover:bg-[#1D283B] cursor-pointer"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
