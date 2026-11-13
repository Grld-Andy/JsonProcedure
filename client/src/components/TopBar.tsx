import React from 'react';
import { Compass, Keyboard, Menu, RefreshCw } from 'lucide-react';
import { type ConnectionStatus } from '../lib/api';
import { DatabaseBrandIcon } from './DatabaseIcons';
import { type WorkspaceTab } from './Sidebar';

interface TopBarProps {
  status: ConnectionStatus | null;
  activeTab: WorkspaceTab;
  onOpenMobileMenu: () => void;
  onRefresh: () => void;
  refreshing: boolean;
  onOpenShortcuts: () => void;
  onStartTour: () => void;
}

const TAB_TITLES: Record<WorkspaceTab, string> = {
  procedures: 'Stored Procedures',
  tables: 'Tables & Data',
  connection: 'Database Connection',
  logs: 'Activity Logs',
};

export const TopBar: React.FC<TopBarProps> = ({
  status,
  activeTab,
  onOpenMobileMenu,
  onRefresh,
  refreshing,
  onOpenShortcuts,
  onStartTour,
}) => {
  return (
    <header className="sticky top-0 z-30 h-16 bg-white/95 dark:bg-[#161F30]/95 backdrop-blur-sm border-b border-[#E6EBF2] dark:border-[#243147] px-4 sm:px-6 flex items-center justify-between gap-8">
      <div className="flex items-center gap-3 min-w-0">
        <button
          type="button"
          onClick={onOpenMobileMenu}
          aria-label="Open navigation menu"
          className="lg:hidden inline-flex items-center gap-1.5 rounded-lg border border-[#D8E1EC] dark:border-[#2C3A52] px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-[#1D283B] shrink-0"
        >
          <Menu className="h-3.5 w-3.5" />
          <span>Menu</span>
        </button>

        <nav aria-label="Breadcrumb" className="flex items-center gap-2 text-sm min-w-0">
          {status?.connected && (
            <DatabaseBrandIcon engine={status.dbType} className="h-4 w-4 shrink-0" />
          )}
          <span className="font-mono text-xs text-slate-500 dark:text-slate-400 truncate max-w-[160px] sm:max-w-none">
            {status?.connected ? status.database : 'Disconnected'}
          </span>
          <span className="text-slate-300 dark:text-slate-600" aria-hidden="true">
            /
          </span>
          <h1 className="font-display font-semibold text-[#172033] dark:text-[#F1F5F9] whitespace-nowrap shrink-0">
            {TAB_TITLES[activeTab]}
          </h1>
        </nav>
      </div>

      <div className="flex items-center gap-2.5 shrink-0">
        <button
          type="button"
          data-tour="topbar-tour"
          onClick={onStartTour}
          title="Start guided product tour"
          aria-label="Start guided product tour"
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-[#D8E1EC] dark:border-[#2C3A52] bg-white dark:bg-[#1D283B] text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-[#243147] transition-colors whitespace-nowrap shrink-0 cursor-pointer"
        >
          <Compass className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400" />
          <span className="hidden sm:inline">Tour</span>
        </button>

        <button
          type="button"
          data-tour="topbar-shortcuts"
          onClick={onOpenShortcuts}
          title="Keyboard shortcuts (?)"
          aria-label="Keyboard shortcuts"
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-[#D8E1EC] dark:border-[#2C3A52] bg-white dark:bg-[#1D283B] text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-[#243147] transition-colors whitespace-nowrap shrink-0 cursor-pointer"
        >
          <Keyboard className="h-3.5 w-3.5 text-slate-400" />
          <span className="hidden sm:inline">Shortcuts</span>
          <kbd className="hidden md:inline-flex items-center justify-center rounded border border-[#E2E8F0] dark:border-[#2C3A52] bg-[#F8FAFC] dark:bg-[#161F30] px-1 text-[10px] font-mono text-slate-400">
            ?
          </kbd>
        </button>

        <button
          type="button"
          onClick={onRefresh}
          disabled={refreshing}
          title="Refresh workspace (Alt + R)"
          className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-[#D8E1EC] dark:border-[#2C3A52] bg-white dark:bg-[#1D283B] text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-[#243147] transition-colors whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-60"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`} />
          <span>Refresh</span>
        </button>
      </div>
    </header>
  );
};
