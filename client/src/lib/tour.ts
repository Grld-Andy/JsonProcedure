import { driver, type Driver, type DriveStep } from 'driver.js';
import 'driver.js/dist/driver.css';
import type { WorkspaceTab } from '../components/Sidebar';
import { pushSettings } from './userData';

const TOUR_SEEN_KEY = 'jp_onboarding_tour_v1';

let activeDriver: Driver | null = null;

export function hasSeenTour(): boolean {
  try {
    return localStorage.getItem(TOUR_SEEN_KEY) === '1';
  } catch {
    return true;
  }
}

export function markTourSeen(): void {
  try {
    localStorage.setItem(TOUR_SEEN_KEY, '1');
  } catch {
    // Ignore storage errors
  }
  pushSettings({ tourSeen: true });
}

/** Records a "seen" flag that came from the server without writing it back. */
export function markTourSeenLocally(): void {
  try {
    localStorage.setItem(TOUR_SEEN_KEY, '1');
  } catch {
    // Ignore storage errors
  }
}

const EXPORT_EVENT = 'jp-tour-export-menu';

/** Opens/closes an ExportMenu (matched by its tourId) so the tour can show the options. */
function setExportMenu(id: string, open: boolean): void {
  window.dispatchEvent(new CustomEvent(EXPORT_EVENT, { detail: { id, open } }));
}

function firstMatch(...selectors: string[]): () => Element {
  return () => {
    for (const s of selectors) {
      const el = document.querySelector(s);
      if (el) return el;
    }
    return document.body;
  };
}

interface StartTourOptions {
  isConnected: boolean;
  onSelectTab: (tab: WorkspaceTab) => void;
  onFinish?: () => void;
}

export function startOnboardingTour({
  isConnected,
  onSelectTab,
  onFinish,
}: StartTourOptions): void {
  if (activeDriver) {
    activeDriver.destroy();
    activeDriver = null;
  }

  const isDesktop = typeof window !== 'undefined' && window.innerWidth >= 1024;
  const tablesTab: WorkspaceTab = isConnected ? 'tables' : 'connection';
  const procTab: WorkspaceTab = isConnected ? 'procedures' : 'connection';
  onSelectTab('connection');

  const steps: DriveStep[] = [
    {
      data: { tab: 'connection' satisfies WorkspaceTab },
      onHighlightStarted: () => onSelectTab('connection'),
      popover: {
        title: 'Welcome to JsonProcedure',
        description:
          'Connect your SQL database, inspect tables and storage metrics, export JSON, CSV or Excel, and execute stored procedures cleanly.',
        align: 'center',
      },
    },
    {
      element: '[data-tour="engine-picker"]',
      waitForElement: 700,
      data: { tab: 'connection' satisfies WorkspaceTab },
      onHighlightStarted: () => onSelectTab('connection'),
      popover: {
        title: 'Pick your SQL database engine',
        description:
          'Choose SQL Server, PostgreSQL, MySQL, SQLite, MariaDB, or Oracle. Default ports, auth modes, and sample connection strings update automatically.',
        side: 'bottom',
        align: 'start',
      },
    },
    {
      element: '[data-tour="connection-form"]',
      waitForElement: 700,
      data: { tab: 'connection' satisfies WorkspaceTab },
      onHighlightStarted: () => onSelectTab('connection'),
      popover: {
        title: 'Configure, test & connect',
        description:
          'Enter connection details or paste a raw connection string. Run Test connection (Alt+T) or Connect & save (Ctrl+Enter) anytime.',
        side: 'top',
        align: 'start',
      },
    },
    {
      element: isConnected
        ? '[data-tour="tables-explorer"]'
        : isDesktop
          ? '[data-tour="nav-tables"]'
          : undefined,
      waitForElement: 800,
      data: { tab: tablesTab },
      onHighlightStarted: () => onSelectTab(tablesTab),
      popover: {
        title: 'Tables, storage & bulk export',
        description:
          'View table sizes and column schemas, create tables from inferred JSON, and select individual rows or entire tables to export.',
        side: isConnected ? 'top' : isDesktop ? 'right' : 'bottom',
        align: 'start',
      },
    },
    {
      element: isConnected
        ? firstMatch('[data-tour="table-export"]', '[data-tour="tables-explorer"]')
        : isDesktop
          ? '[data-tour="nav-tables"]'
          : undefined,
      waitForElement: 800,
      data: { tab: tablesTab },
      onHighlightStarted: () => onSelectTab(tablesTab),
      onHighlighted: () => setExportMenu('table-export', true),
      onDeselected: () => setExportMenu('table-export', false),
      popover: {
        title: 'Export as JSON, CSV or Excel',
        description:
          'Open a table and click Export to choose JSON, CSV or Excel (.xlsx). Export just the rows you ticked or the entire table.',
        side: isConnected ? 'left' : isDesktop ? 'right' : 'bottom',
        align: 'start',
      },
    },
    {
      element: isConnected
        ? '[data-tour="procedures-runner"]'
        : isDesktop
          ? '[data-tour="nav-procedures"]'
          : undefined,
      waitForElement: 800,
      data: { tab: procTab },
      onHighlightStarted: () => onSelectTab(procTab),
      popover: {
        title: 'Write and execute stored procedures',
        description:
          'Edit T-SQL with syntax highlighting and one-click Format, select a procedure, fill in typed parameters, and press Ctrl+Enter to execute.',
        side: isConnected ? 'top' : isDesktop ? 'right' : 'bottom',
        align: 'start',
      },
    },
    ...(isDesktop
      ? [
          {
            element: '[data-tour="api-mode-btn"]',
            waitForElement: 500,
            data: { tab: procTab },
            onHighlightStarted: () => onSelectTab(procTab),
            popover: {
              title: 'Simulation & Live API modes',
              description:
                'Test everything locally in Simulation Mode without touching a live server, or switch to Live Backend API when connecting to real endpoints.',
              side: 'right' as const,
              align: 'end' as const,
            },
          } satisfies DriveStep,
        ]
      : []),
    {
      element: isConnected
        ? '[data-tour="procedure-export"]'
        : isDesktop
          ? '[data-tour="nav-procedures"]'
          : undefined,
      waitForElement: 800,
      data: { tab: procTab },
      onHighlightStarted: () => onSelectTab(procTab),
      onHighlighted: () => setExportMenu('procedure-export', true),
      onDeselected: () => setExportMenu('procedure-export', false),
      popover: {
        title: 'Export procedure results',
        description:
          'After you execute a procedure, Export results lets you download the output as JSON, CSV or Excel (.xlsx). Multiple result sets become separate sheets in Excel.',
        side: isConnected ? 'left' : isDesktop ? 'right' : 'bottom',
        align: 'end',
      },
    },
    {
      element: '[data-tour="topbar-tour"]',
      waitForElement: 500,
      data: { tab: procTab },
      onHighlightStarted: () => onSelectTab(procTab),
      popover: {
        title: 'Keyboard shortcuts & replay tour',
        description:
          'Press ? anytime for all keyboard shortcuts, or click Tour in the header whenever newcomers want to revisit this walkthrough.',
        side: 'bottom',
        align: 'end',
      },
    },
  ];

  const instance = driver({
    steps,
    animate: true,
    smoothScroll: true,
    allowClose: true,
    allowKeyboardControl: true,
    stagePadding: 8,
    stageRadius: 12,
    overlayOpacity: 0.48,
    popoverClass: 'jp-tour-popover',
    showProgress: true,
    progressText: 'Step {{current}} of {{total}}',
    prevBtnText: 'Back',
    nextBtnText: 'Next',
    doneBtnText: 'Finish tour',
    onNextClick: (_el, _step, { state, driver: d }) => {
      const idx = state.activeIndex ?? 0;
      const nextStep = steps[idx + 1];
      const nextTab = nextStep?.data?.tab as WorkspaceTab | undefined;
      if (nextTab) {
        onSelectTab(nextTab);
      }
      d.moveNext();
    },
    onPrevClick: (_el, _step, { state, driver: d }) => {
      const idx = state.activeIndex ?? 0;
      const prevStep = steps[idx - 1];
      const prevTab = prevStep?.data?.tab as WorkspaceTab | undefined;
      if (prevTab) {
        onSelectTab(prevTab);
      }
      d.movePrevious();
    },
    onDestroyed: () => {
      setExportMenu('table-export', false);
      setExportMenu('procedure-export', false);
      markTourSeen();
      if (activeDriver === instance) {
        activeDriver = null;
      }
      onFinish?.();
    },
  });

  activeDriver = instance;
  window.setTimeout(() => {
    instance.drive(0);
  }, 160);
}
