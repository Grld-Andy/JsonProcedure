import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, ArrowUp, CheckCircle2, X } from 'lucide-react';
import { AnimatePresence, motion, MotionConfig } from 'motion/react';
import {
  hasSavedProfile,
  loadSavedProfile,
  saveSavedProfile,
  type SidebarProfile,
} from './components/avatars';
import { ConnectionModeModal } from './components/ConnectionModeModal';
import { ProfileModal } from './components/ProfileModal';
import { isEditableTarget, ShortcutsModal } from './components/ShortcutsModal';
import { Sidebar, type WorkspaceTab } from './components/Sidebar';
import { TopBar } from './components/TopBar';
import {
  type ApiRuntimeConfig,
  connectionApi,
  type ConnectionStatus,
  getApiConfig,
  setApiConfig,
} from './lib/api';
import { hasSeenTour, markTourSeenLocally, startOnboardingTour } from './lib/tour';
import { pushSettings, settingsApi } from './lib/userData';
import { ConnectionPage } from './pages/ConnectionPage';
import { LogsPage } from './pages/LogsPage';
import { ProceduresPage } from './pages/ProceduresPage';
import { TablesPage } from './pages/TablesPage';

const THEME_KEY = 'jp_theme';

function readLocalTheme(): boolean {
  try {
    return localStorage.getItem(THEME_KEY) === 'dark';
  } catch {
    return false;
  }
}

function hasLocalTheme(): boolean {
  try {
    return localStorage.getItem(THEME_KEY) !== null;
  } catch {
    return false;
  }
}

interface ToastItem {
  id: number;
  text: string;
  tone: 'success' | 'error';
}

export default function App() {
  const [status, setStatus] = useState<ConnectionStatus | null>(null);
  const [tab, setTab] = useState<WorkspaceTab>('connection');
  const [refreshKey, setRefreshKey] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const [isDark, setIsDark] = useState(() => readLocalTheme());
  const settingsSynced = useRef(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [apiCfg, setApiCfg] = useState<ApiRuntimeConfig>(() => getApiConfig());
  const [apiModalOpen, setApiModalOpen] = useState(false);
  const [profile, setProfile] = useState<SidebarProfile>(() => loadSavedProfile());
  const [profileModalOpen, setProfileModalOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [showBackToTop, setShowBackToTop] = useState(false);

  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const nextToastId = useRef(1);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', isDark);
    try {
      localStorage.setItem(THEME_KEY, isDark ? 'dark' : 'light');
    } catch {
      /* ignore storage errors */
    }
    if (settingsSynced.current) pushSettings({ theme: isDark ? 'dark' : 'light' });
  }, [isDark]);

  useEffect(() => {
    const onScroll = () => {
      setShowBackToTop(window.scrollY > 200);
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const dismissToast = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const notify = useCallback(
    (text: string, tone: 'success' | 'error' = 'success') => {
      const id = nextToastId.current++;
      setToasts((prev) => [...prev.slice(-2), { id, text, tone }]);
    },
    []
  );

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const s = await connectionApi.status();
      setStatus(s);
      return s;
    } catch {
      setStatus(null);
      return null;
    } finally {
      setLoaded(true);
      setRefreshing(false);
    }
  }, []);

  const autoTourTriggered = useRef(false);

  const launchTour = useCallback(
    (connectedOverride?: boolean) => {
      setMobileMenuOpen(false);
      setApiModalOpen(false);
      setProfileModalOpen(false);
      setShortcutsOpen(false);
      startOnboardingTour({
        isConnected: connectedOverride ?? Boolean(status?.connected),
        onSelectTab: setTab,
      });
    },
    [status?.connected]
  );

  // Pull profile / theme / tour flag from the server's SQLite store. Values that only exist in this
  // browser (from before the backend stored them) are uploaded once instead of being lost.
  const syncSettings = useCallback(async () => {
    settingsSynced.current = false;
    if (!apiCfg.isLive) return;
    try {
      const s = await settingsApi.get();
      const upload: Record<string, unknown> = {};

      if (s.theme === 'dark' || s.theme === 'light') setIsDark(s.theme === 'dark');
      else if (hasLocalTheme()) upload.theme = readLocalTheme() ? 'dark' : 'light';

      if (s.profile && typeof s.profile === 'object') setProfile(saveSavedProfile(s.profile as SidebarProfile));
      else if (hasSavedProfile()) upload.profile = loadSavedProfile();

      if (s.tourSeen === true) markTourSeenLocally();
      else if (hasSeenTour()) upload.tourSeen = true;

      if (Object.keys(upload).length > 0) await settingsApi.put(upload);
      settingsSynced.current = true;
    } catch {
      /* backend unreachable: keep using the browser copies */
    }
  }, [apiCfg.isLive]);

  useEffect(() => {
    void syncSettings()
      .then(() => refresh())
      .then((s) => {
        if (!s?.connected) setTab('connection');
        if (!autoTourTriggered.current && !hasSeenTour()) {
          autoTourTriggered.current = true;
          window.setTimeout(() => {
            startOnboardingTour({
              isConnected: Boolean(s?.connected),
              onSelectTab: setTab,
            });
          }, 320);
        }
      });
  }, [refresh, syncSettings, apiCfg.isLive, apiCfg.baseUrl]);

  const onConnectionChanged = async () => {
    const s = await refresh();
    setRefreshKey((k) => k + 1);
    if (s?.connected) setTab('procedures');
  };

  const handleSaveApiConfig = (next: ApiRuntimeConfig) => {
    const updated = setApiConfig(next);
    setApiCfg(updated);
    setRefreshKey((k) => k + 1);
    notify(
      updated.isLive ? 'Switched to Live Backend API' : 'Switched to Simulation Mode',
      'success'
    );
  };

  const handleSaveProfile = (next: SidebarProfile) => {
    const saved = saveSavedProfile(next);
    setProfile(saved);
    pushSettings({ profile: saved });
    notify('Profile updated', 'success');
  };

  const handleManualRefresh = useCallback(async () => {
    const s = await refresh();
    setRefreshKey((k) => k + 1);
    if (s) {
      notify('Workspace refreshed', 'success');
    } else {
      notify('Unable to reach database connection', 'error');
    }
  }, [refresh, notify]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const anyModalOpen = apiModalOpen || profileModalOpen || shortcutsOpen;

      if (e.key === 'Escape') {
        if (shortcutsOpen) setShortcutsOpen(false);
        else if (apiModalOpen) setApiModalOpen(false);
        else if (profileModalOpen) setProfileModalOpen(false);
        else if (mobileMenuOpen) setMobileMenuOpen(false);
        return;
      }

      if (e.key === '?' && !e.ctrlKey && !e.metaKey && !e.altKey && !isEditableTarget(e.target)) {
        if (!apiModalOpen && !profileModalOpen) {
          e.preventDefault();
          setShortcutsOpen((prev) => !prev);
        }
        return;
      }

      if (anyModalOpen) return;

      if (e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
        const key = e.key.toLowerCase();
        if (key === '1') {
          e.preventDefault();
          setTab('connection');
        } else if (key === '2') {
          e.preventDefault();
          setTab('tables');
        } else if (key === '3') {
          e.preventDefault();
          setTab('procedures');
        } else if (key === '4') {
          e.preventDefault();
          setTab('logs');
        } else if (key === 'r') {
          e.preventDefault();
          void handleManualRefresh();
        } else if (key === 'd') {
          e.preventDefault();
          setIsDark((d) => !d);
        }
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [apiModalOpen, profileModalOpen, shortcutsOpen, mobileMenuOpen, handleManualRefresh]);

  return (
    <MotionConfig reducedMotion="user">
      <div className="min-h-screen flex bg-[#F5F7FA] dark:bg-[#0F1623] text-[#172033] dark:text-[#E6ECF5]">
        <Sidebar
          status={status}
          loaded={loaded}
          activeTab={tab}
          onSelectTab={setTab}
          isLive={apiCfg.isLive}
          onOpenApiModal={() => setApiModalOpen(true)}
          profile={profile}
          onOpenProfileModal={() => setProfileModalOpen(true)}
          isDark={isDark}
          onToggleTheme={() => setIsDark((d) => !d)}
          mobileOpen={mobileMenuOpen}
          onCloseMobile={() => setMobileMenuOpen(false)}
        />

        <div className="flex-1 flex flex-col min-w-0">
          <TopBar
            status={status}
            activeTab={tab}
            onOpenMobileMenu={() => setMobileMenuOpen(true)}
            onRefresh={handleManualRefresh}
            refreshing={refreshing}
            onOpenShortcuts={() => setShortcutsOpen(true)}
            onStartTour={() => launchTour()}
          />

          <main className="flex-1 mx-auto max-w-[1320px] w-full px-4 sm:px-6 lg:px-8 py-6">
            <AnimatePresence mode="wait">
              <motion.div
                key={tab}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.16, ease: 'easeOut' }}
              >
                {tab === 'procedures' &&
                  (status?.connected ? (
                    <ProceduresPage
                      refreshKey={refreshKey}
                      onNotify={notify}
                    />
                  ) : (
                    <NeedConnection onGoConnect={() => setTab('connection')} />
                  ))}

                {tab === 'tables' &&
                  (status?.connected ? (
                    <TablesPage
                      refreshKey={refreshKey}
                      databaseName={status.database ?? undefined}
                      serverName={status.server ?? undefined}
                      onNotify={notify}
                    />
                  ) : (
                    <NeedConnection onGoConnect={() => setTab('connection')} />
                  ))}

                {tab === 'logs' && <LogsPage refreshKey={refreshKey} isLive={apiCfg.isLive} onNotify={notify} />}

                {tab === 'connection' && (
                  <ConnectionPage
                    key={loaded ? 'ready' : 'loading'}
                    status={status}
                    loading={!loaded}
                    onChanged={onConnectionChanged}
                    onNotify={notify}
                  />
                )}
              </motion.div>
            </AnimatePresence>
          </main>
        </div>

        {/* Floating Back to Top Button */}
        <AnimatePresence>
          {showBackToTop && (
            <motion.button
              type="button"
              initial={{ opacity: 0, scale: 0.85, y: 12 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.85, y: 12 }}
              whileHover={{ y: -2 }}
              whileTap={{ scale: 0.92 }}
              transition={{ duration: 0.18 }}
              onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
              aria-label="Scroll back to top"
              title="Back to top"
              className="fixed bottom-6 right-6 z-40 inline-flex h-10 w-10 items-center justify-center rounded-full border border-[#D8E1EC] dark:border-[#2C3A52] bg-white/95 dark:bg-[#161F30]/95 backdrop-blur-sm text-blue-600 dark:text-blue-400 shadow-lg hover:bg-blue-50 hover:text-blue-700 hover:border-blue-300 dark:hover:bg-[#1D283B] dark:hover:text-blue-300 cursor-pointer"
            >
              <ArrowUp className="h-4 w-4" />
            </motion.button>
          )}
        </AnimatePresence>

      {/* Animated Toast Stack */}
      <div
        aria-live="polite"
        aria-atomic="false"
        className="fixed top-20 right-5 z-50 flex flex-col items-end gap-2.5 pointer-events-none max-w-sm w-[calc(100vw-2.5rem)] sm:w-auto"
      >
        <AnimatePresence initial={false}>
          {toasts.map((t) => (
            <ToastCard key={t.id} item={t} onDismiss={dismissToast} />
          ))}
        </AnimatePresence>
      </div>

      <ConnectionModeModal
        open={apiModalOpen}
        config={apiCfg}
        onClose={() => setApiModalOpen(false)}
        onSave={handleSaveApiConfig}
      />

      <ProfileModal
        open={profileModalOpen}
        profile={profile}
        onClose={() => setProfileModalOpen(false)}
        onSave={handleSaveProfile}
      />

      <ShortcutsModal
        open={shortcutsOpen}
        onClose={() => setShortcutsOpen(false)}
        onStartTour={() => launchTour()}
      />
      </div>
    </MotionConfig>
  );
}

const TOAST_DURATION_MS = 3800;

function ToastCard({
  item,
  onDismiss,
}: {
  item: ToastItem;
  onDismiss: (id: number) => void;
}) {
  const [paused, setPaused] = useState(false);
  const elapsedRef = useRef(0);
  const barRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (paused) return;
    let rafId = 0;
    let lastTs = performance.now();

    const tick = (now: number) => {
      const dt = Math.min(now - lastTs, 100);
      lastTs = now;
      elapsedRef.current += dt;
      const ratio = Math.max(0, 1 - elapsedRef.current / TOAST_DURATION_MS);
      if (barRef.current) {
        barRef.current.style.transform = `scaleX(${ratio})`;
      }
      if (elapsedRef.current >= TOAST_DURATION_MS) {
        onDismiss(item.id);
        return;
      }
      rafId = window.requestAnimationFrame(tick);
    };

    rafId = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(rafId);
  }, [paused, item.id, onDismiss]);

  return (
    <motion.div
      layout
      role="status"
      initial={{ opacity: 0, y: -16, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, x: 48, scale: 0.95 }}
      transition={{ duration: 0.22, ease: 'easeOut' }}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
      className={`pointer-events-auto relative overflow-hidden rounded-xl border shadow-lg backdrop-blur-sm ${
        item.tone === 'error'
          ? 'border-rose-200 dark:border-rose-900 bg-rose-50/95 dark:bg-rose-950/95 text-rose-900 dark:text-rose-100'
          : 'border-emerald-200/80 dark:border-emerald-900/60 bg-white/95 dark:bg-[#161F30]/95 text-[#172033] dark:text-[#F1F5F9]'
      }`}
    >
      <div className="flex items-center gap-3 px-4 py-3 text-xs font-medium">
        {item.tone === 'error' ? (
          <AlertTriangle className="h-4 w-4 shrink-0 text-rose-600 dark:text-rose-400" />
        ) : (
          <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
        )}
        <span className="leading-snug">{item.text}</span>
        <button
          type="button"
          onClick={() => onDismiss(item.id)}
          aria-label="Dismiss notification"
          className="ml-1 inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium text-slate-500 hover:bg-black/5 dark:text-slate-400 dark:hover:bg-white/10 cursor-pointer shrink-0"
        >
          <X className="h-3 w-3" />
          <span>Close</span>
        </button>
      </div>
      <div
        ref={barRef}
        style={{ transformOrigin: 'left', transform: 'scaleX(1)' }}
        className={`h-0.5 w-full ${
          item.tone === 'error' ? 'bg-rose-500/75' : 'bg-emerald-500/75'
        }`}
      />
    </motion.div>
  );
}

function NeedConnection({ onGoConnect }: { onGoConnect: () => void }) {
  return (
    <div className="rounded-xl bg-white dark:bg-[#161F30] border border-[#E6EBF2] dark:border-[#243147] p-10 text-center space-y-3">
      <p className="text-sm font-medium text-[#172033] dark:text-[#F1F5F9]">
        Connect to a database first
      </p>
      <p className="text-xs text-slate-500 dark:text-slate-400">
        Open the Connection view in the sidebar to enter your server details or connection string.
      </p>
      <button
        type="button"
        onClick={onGoConnect}
        className="inline-flex items-center px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-xs font-semibold text-white cursor-pointer"
      >
        Go to Connection
      </button>
    </div>
  );
}
