import React from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Database,
  FileCode2,
  Moon,
  Plug,
  ScrollText,
  Sun,
  Table2,
  X,
} from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { type ConnectionStatus } from '../lib/api';
import { AvatarGraphic, type SidebarProfile } from './avatars';
import { DatabaseBrandIcon, getDatabaseEngineMeta } from './DatabaseIcons';

export type WorkspaceTab = 'procedures' | 'tables' | 'connection' | 'logs';

interface SidebarProps {
  status: ConnectionStatus | null;
  loaded: boolean;
  activeTab: WorkspaceTab;
  onSelectTab: (tab: WorkspaceTab) => void;
  profile: SidebarProfile;
  onOpenProfileModal: () => void;
  isDark: boolean;
  onToggleTheme: () => void;
  mobileOpen: boolean;
  onCloseMobile: () => void;
}

const NAV_ITEMS: {
  id: WorkspaceTab;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}[] = [
  { id: 'connection', label: 'Connection', icon: Plug },
  { id: 'tables', label: 'Tables', icon: Table2 },
  { id: 'procedures', label: 'Procedures', icon: FileCode2 },
  { id: 'logs', label: 'Logs', icon: ScrollText },
];

export const Sidebar: React.FC<SidebarProps> = ({
  status,
  loaded,
  activeTab,
  onSelectTab,
  profile,
  onOpenProfileModal,
  isDark,
  onToggleTheme,
  mobileOpen,
  onCloseMobile,
}) => {
  const engineMeta = getDatabaseEngineMeta(status?.dbType);

  const sidebarContent = (
    <div className="flex h-full w-64 flex-col bg-white dark:bg-[#161F30] border-r border-[#E6EBF2] dark:border-[#243147]">
      {/* Brand Wordmark */}
      <div className="flex items-center justify-between gap-2 px-5 h-16 border-b border-[#E6EBF2] dark:border-[#243147]">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-blue-600 text-white">
            <Database className="h-4 w-4" />
          </div>
          <span className="font-display text-base font-bold tracking-tight text-[#172033] dark:text-[#F1F5F9] whitespace-nowrap truncate">
            JsonProcedure
          </span>
        </div>
        <button
          type="button"
          onClick={onCloseMobile}
          aria-label="Close navigation menu"
          title="Close navigation menu"
          className="lg:hidden inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-[#E6EBF2] dark:border-[#2C3A52] text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-[#1D283B] transition-colors cursor-pointer"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Connected Database Summary */}
      <div className="px-4 py-3.5 border-b border-[#E6EBF2] dark:border-[#243147]">
        {!loaded ? (
          <div aria-busy="true" aria-label="Loading connection status" className="space-y-2 animate-pulse py-0.5">
            <div className="h-3 w-20 rounded bg-slate-200 dark:bg-slate-700" />
            <div className="h-3.5 w-32 rounded bg-slate-200/90 dark:bg-slate-700/80" />
            <div className="h-3 w-36 rounded bg-slate-100 dark:bg-slate-800" />
          </div>
        ) : (
          <button
            type="button"
            onClick={() => {
              onSelectTab('connection');
              onCloseMobile();
            }}
            className="w-full text-left group cursor-pointer"
          >
            <div className="flex items-center justify-between gap-2 text-[11px] font-medium">
              <div className="flex items-center gap-1.5 min-w-0">
                {status?.connected ? (
                  <>
                    <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
                    <span className="text-emerald-700 dark:text-emerald-400">Connected</span>
                  </>
                ) : (
                  <>
                    <AlertTriangle className="h-3.5 w-3.5 text-rose-600 dark:text-rose-400 shrink-0" />
                    <span className="text-rose-700 dark:text-rose-400">Not connected</span>
                  </>
                )}
              </div>
              {status?.connected && (
                <span className="inline-flex items-center gap-1 text-[10px] text-slate-500 dark:text-slate-400 shrink-0">
                  <DatabaseBrandIcon engine={status.dbType} className="h-3.5 w-3.5 shrink-0" />
                  <span>{engineMeta.name}</span>
                </span>
              )}
            </div>
            <div className="mt-1 font-mono text-xs font-semibold text-[#172033] dark:text-[#F1F5F9] truncate group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors">
              {status?.connected ? status.database : 'Configure database'}
            </div>
            <div className="mt-0.5 font-mono text-[11px] text-slate-500 dark:text-slate-400 truncate">
              {status?.connected
                ? engineMeta.isFileBased
                  ? 'Local SQLite file'
                  : `${status.server} · ${status.authType === 'sql' ? status.user : 'Windows auth'}`
                : 'Click to connect'}
            </div>
          </button>
        )}
      </div>

      {/* Primary Navigation */}
      <nav aria-label="Workspace sections" className="flex-1 overflow-y-auto px-3 py-4 space-y-1">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const active = activeTab === item.id;
          return (
            <button
              key={item.id}
              type="button"
              data-tour={`nav-${item.id}`}
              onClick={() => {
                onSelectTab(item.id);
                onCloseMobile();
              }}
              className={`relative w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer active:scale-[0.98] ${
                active
                  ? 'text-blue-700 dark:text-blue-300'
                  : 'text-slate-600 hover:bg-slate-100/80 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-[#1D283B] dark:hover:text-white'
              }`}
            >
              {active && (
                <motion.span
                  layoutId="sidebar-nav-active"
                  transition={{ type: 'spring', stiffness: 450, damping: 35 }}
                  className="absolute inset-0 rounded-lg bg-blue-50 dark:bg-blue-950/60"
                />
              )}
              <Icon
                className={`relative z-10 h-4 w-4 shrink-0 transition-colors ${
                  active ? 'text-blue-600 dark:text-blue-400' : 'text-slate-400 dark:text-slate-500'
                }`}
              />
              <span className="relative z-10">{item.label}</span>
            </button>
          );
        })}
      </nav>

      {/* Footer: Profile Modal Trigger & Theme */}
      <div className="px-4 py-3.5 border-t border-[#E6EBF2] dark:border-[#243147] space-y-3">
        <div className="flex items-center justify-between gap-2 pt-0.5">
          <button
            type="button"
            onClick={onOpenProfileModal}
            title="Click to update profile and avatar"
            className="flex items-center gap-2.5 min-w-0 flex-1 text-left rounded-lg p-1.5 -ml-1.5 hover:bg-slate-100/80 dark:hover:bg-[#1D283B] transition-colors cursor-pointer"
          >
            <AvatarGraphic
              avatarId={profile.avatar}
              className="h-8 w-8 border border-[#E2E8F0] dark:border-[#2C3A52]"
            />
            <div className="min-w-0">
              <div className="text-xs font-semibold text-[#172033] dark:text-[#F1F5F9] truncate">
                {profile.name}
              </div>
              <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                {profile.title}
              </div>
            </div>
          </button>

          <button
            type="button"
            onClick={onToggleTheme}
            aria-label={isDark ? 'Switch to light theme' : 'Switch to dark theme'}
            title={isDark ? 'Switch to light theme' : 'Switch to dark theme'}
            className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg border border-[#E6EBF2] dark:border-[#2C3A52] px-2.5 text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-[#1D283B] transition-colors cursor-pointer whitespace-nowrap"
          >
            {isDark ? <Sun className="h-3.5 w-3.5" /> : <Moon className="h-3.5 w-3.5" />}
            <span>{isDark ? 'Light' : 'Dark'}</span>
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <>
      <aside className="hidden lg:block shrink-0 h-screen sticky top-0">{sidebarContent}</aside>
      <AnimatePresence>
        {mobileOpen && (
          <div className="fixed inset-0 z-50 lg:hidden flex">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.18 }}
              className="fixed inset-0 bg-slate-950/40 backdrop-blur-[1px]"
              onClick={onCloseMobile}
              aria-hidden="true"
            />
            <motion.aside
              initial={{ x: '-100%' }}
              animate={{ x: 0 }}
              exit={{ x: '-100%' }}
              transition={{ type: 'spring', stiffness: 380, damping: 36 }}
              className="relative z-10 h-full"
            >
              {sidebarContent}
            </motion.aside>
          </div>
        )}
      </AnimatePresence>
    </>
  );
};
