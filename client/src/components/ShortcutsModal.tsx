import React, { useEffect } from 'react';
import { Compass, Keyboard, X } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';

export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return (
    tag === 'INPUT' ||
    tag === 'TEXTAREA' ||
    tag === 'SELECT' ||
    target.isContentEditable
  );
}

export function getPrimaryModLabel(): string {
  if (typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/i.test(navigator.platform)) {
    return '⌘';
  }
  return 'Ctrl';
}

interface ShortcutEntry {
  keys: string[];
  label: string;
}

interface ShortcutGroup {
  title: string;
  items: ShortcutEntry[];
}

interface ShortcutsModalProps {
  open: boolean;
  onClose: () => void;
  onStartTour?: () => void;
}

export const ShortcutsModal: React.FC<ShortcutsModalProps> = ({ open, onClose, onStartTour }) => {
  const mod = getPrimaryModLabel();

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  const groups: ShortcutGroup[] = [
    {
      title: 'Workspace & navigation',
      items: [
        { keys: ['Alt', '1'], label: 'Open Connection view' },
        { keys: ['Alt', '2'], label: 'Open Tables & Data view' },
        { keys: ['Alt', '3'], label: 'Open Stored Procedures view' },
        { keys: ['Alt', '4'], label: 'Open Activity Logs view' },
        { keys: ['Alt', 'R'], label: 'Refresh workspace connection' },
        { keys: ['Alt', 'D'], label: 'Toggle light / dark theme' },
        { keys: ['?'], label: 'Show or hide this shortcuts guide' },
        { keys: ['Esc'], label: 'Close open dialog' },
      ],
    },
    {
      title: 'Stored procedures',
      items: [
        { keys: [mod, 'Enter'], label: 'Execute selected procedure' },
        { keys: [mod, 'S'], label: 'Save procedure script' },
        { keys: ['Alt', 'N'], label: 'Start a new procedure' },
        { keys: ['/'], label: 'Focus procedure filter' },
      ],
    },
    {
      title: 'Tables & connection',
      items: [
        { keys: [mod, 'Enter'], label: 'Create table, insert row, or connect' },
        { keys: ['Alt', 'N'], label: 'Start creating a new table' },
        { keys: ['Alt', 'E'], label: 'Export selected rows or entire table to JSON' },
        { keys: ['Alt', 'T'], label: 'Test database connection' },
        { keys: ['/'], label: 'Focus table filter' },
      ],
    },
  ];

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/45 backdrop-blur-[1px]"
          role="dialog"
          aria-modal="true"
          aria-labelledby="shortcuts-modal-title"
          onClick={onClose}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 10 }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-xl rounded-xl bg-white dark:bg-[#161F30] border border-[#E2E8F0] dark:border-[#243147] shadow-lg overflow-hidden"
          >
            <div className="flex items-center justify-between px-6 py-4 border-b border-[#E2E8F0] dark:border-[#243147] bg-[#FAFBFD] dark:bg-[#1D283B]/40">
              <div className="flex items-center gap-2.5">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-blue-50 dark:bg-blue-950/60 border border-blue-200/70 dark:border-blue-800/70 text-blue-600 dark:text-blue-400">
                  <Keyboard className="h-4 w-4" />
                </div>
                <div>
                  <h2
                    id="shortcuts-modal-title"
                    className="font-display text-base font-semibold text-[#172033] dark:text-[#F1F5F9]"
                  >
                    Keyboard shortcuts
                  </h2>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    Press <kbd className="font-mono font-semibold">?</kbd> anytime outside text fields to toggle this panel.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close modal"
                className="inline-flex items-center gap-1 rounded-lg border border-[#E2E8F0] dark:border-[#2C3A52] bg-white dark:bg-[#1D283B] px-2.5 py-1 text-xs font-medium text-slate-500 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-[#243147] cursor-pointer transition-transform active:scale-95"
              >
                <X className="h-3.5 w-3.5" />
                <span>Close</span>
              </button>
            </div>

            <div className="p-6 space-y-5 max-h-[75vh] overflow-y-auto">
              {groups.map((group) => (
                <div key={group.title} className="space-y-2">
                  <h3 className="text-xs font-semibold text-slate-500 dark:text-slate-400">
                    {group.title}
                  </h3>
                  <div className="divide-y divide-[#EEF2F7] dark:divide-[#243147] rounded-xl border border-[#E6EBF2] dark:border-[#243147] bg-[#FAFBFD]/60 dark:bg-[#111927]/40">
                    {group.items.map((item) => (
                      <div
                        key={`${group.title}-${item.label}`}
                        className="flex items-center justify-between gap-4 px-4 py-2.5 text-xs"
                      >
                        <span className="text-[#172033] dark:text-[#E6ECF5]">
                          {item.label}
                        </span>
                        <div className="flex items-center gap-1 shrink-0">
                          {item.keys.map((key, idx) => (
                            <React.Fragment key={key}>
                              {idx > 0 && (
                                <span className="text-[10px] text-slate-400 dark:text-slate-500">
                                  +
                                </span>
                              )}
                              <kbd className="inline-flex min-w-[24px] items-center justify-center rounded-md border border-[#D8E1EC] dark:border-[#2C3A52] bg-white dark:bg-[#1D283B] px-1.5 py-0.5 font-mono text-[11px] font-medium text-[#172033] dark:text-[#E6ECF5] shadow-2xs">
                                {key}
                              </kbd>
                            </React.Fragment>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>

            {onStartTour && (
              <div className="px-6 py-3.5 border-t border-[#E2E8F0] dark:border-[#243147] bg-[#FAFBFD] dark:bg-[#1D283B]/40 flex items-center justify-between gap-3">
                <span className="text-xs text-slate-500 dark:text-slate-400">
                  New to JsonProcedure?
                </span>
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    onStartTour();
                  }}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-[#D8E1EC] dark:border-[#2C3A52] bg-white dark:bg-[#1D283B] px-3 py-1.5 text-xs font-medium text-blue-600 dark:text-blue-400 hover:bg-blue-50/70 dark:hover:bg-[#243147] cursor-pointer transition-colors"
                >
                  <Compass className="h-3.5 w-3.5" />
                  <span>Take interactive tour</span>
                </button>
              </div>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
