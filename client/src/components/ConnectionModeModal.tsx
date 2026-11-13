import React, { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, X } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { type ApiRuntimeConfig, connectionApi } from '../lib/api';

interface ConnectionModeModalProps {
  open: boolean;
  config: ApiRuntimeConfig;
  onClose: () => void;
  onSave: (next: ApiRuntimeConfig) => void;
}

export const ConnectionModeModal: React.FC<ConnectionModeModalProps> = ({
  open,
  config,
  onClose,
  onSave,
}) => {
  const [draft, setDraft] = useState<ApiRuntimeConfig>(config);
  const [testing, setTesting] = useState(false);
  const [checkResult, setCheckResult] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    if (open) {
      setDraft(config);
      setCheckResult(null);
    }
  }, [open, config]);

  const handleTest = async () => {
    setTesting(true);
    setCheckResult(null);
    onSave(draft);
    try {
      const s = await connectionApi.status();
      setCheckResult({
        ok: true,
        text: draft.isLive
          ? `Live backend responded (${s.connected ? `${s.server} / ${s.database}` : 'not connected'}).`
          : 'Simulation mode active.',
      });
    } catch (err) {
      setCheckResult({
        ok: false,
        text: err instanceof Error ? err.message : 'Unable to reach /api/connection.',
      });
    } finally {
      setTesting(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave(draft);
    onClose();
  };

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
          aria-labelledby="api-mode-title"
          onClick={onClose}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 10 }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-lg rounded-xl bg-white dark:bg-[#161F30] border border-[#E2E8F0] dark:border-[#243147] shadow-lg overflow-hidden"
          >
            <div className="flex items-center justify-between px-6 py-4 border-b border-[#E2E8F0] dark:border-[#243147]">
              <h2 id="api-mode-title" className="font-display text-base font-semibold text-[#172033] dark:text-[#F1F5F9]">
                Backend API Mode
              </h2>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close modal"
                className="inline-flex items-center gap-1 rounded-lg border border-[#E2E8F0] dark:border-[#2C3A52] px-2 py-1 text-xs font-medium text-slate-500 hover:bg-slate-100 dark:hover:bg-[#1D283B] cursor-pointer transition-transform active:scale-95"
              >
                <X className="h-3.5 w-3.5" />
                <span>Close</span>
              </button>
            </div>

            <form onSubmit={handleSubmit} className="p-6 space-y-5">
              <div>
                <span className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-2">
                  Execution Switch
                </span>
                <div className="grid grid-cols-2 gap-2 p-1 rounded-lg bg-[#EEF2F7] dark:bg-[#1D283B]">
                  <button
                    type="button"
                    onClick={() => setDraft((p) => ({ ...p, isLive: false }))}
                    className={`py-2 px-3 rounded-md text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap ${
                      !draft.isLive
                        ? 'bg-white dark:bg-[#161F30] text-[#172033] dark:text-white shadow-xs'
                        : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                    }`}
                  >
                    Simulation
                  </button>
                  <button
                    type="button"
                    onClick={() => setDraft((p) => ({ ...p, isLive: true }))}
                    className={`py-2 px-3 rounded-md text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap ${
                      draft.isLive
                        ? 'bg-blue-600 text-white shadow-xs'
                        : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                    }`}
                  >
                    Live Backend
                  </button>
                </div>
                <p className="mt-2 text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                  Simulation runs all endpoints locally for UI testing.
                </p>
              </div>

              <div>
                <label htmlFor="api-base-url" className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                  Backend Base URL (optional)
                </label>
                <input
                  id="api-base-url"
                  type="text"
                  value={draft.baseUrl}
                  onChange={(e) => setDraft((p) => ({ ...p, baseUrl: e.target.value }))}
                  placeholder="Leave empty for same origin (/api/...) or e.g. http://localhost:5000"
                  className="w-full rounded-lg border border-[#D8E1EC] dark:border-[#2C3A52] bg-[#F8FAFC] dark:bg-[#1D283B] px-3 py-2 text-xs font-mono text-[#172033] dark:text-[#E6ECF5]"
                />
              </div>

              <AnimatePresence>
                {checkResult && (
                  <motion.div
                    initial={{ opacity: 0, y: -4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -4 }}
                    className={`flex items-start gap-2 rounded-lg border px-3.5 py-2.5 text-xs ${
                      checkResult.ok
                        ? 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-300'
                        : 'border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-300'
                    }`}
                  >
                    {checkResult.ok ? (
                      <CheckCircle2 className="h-4 w-4 shrink-0 mt-0.5" />
                    ) : (
                      <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                    )}
                    <span>{checkResult.text}</span>
                  </motion.div>
                )}
              </AnimatePresence>

              <div className="flex items-center justify-between gap-3 pt-2 border-t border-[#E2E8F0] dark:border-[#243147]">
                <button
                  type="button"
                  onClick={handleTest}
                  disabled={testing}
                  className="px-3.5 py-2 rounded-lg border border-[#D8E1EC] dark:border-[#2C3A52] text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-[#1D283B] cursor-pointer whitespace-nowrap transition-transform active:scale-95"
                >
                  {testing ? 'Checking...' : 'Check /api/connection'}
                </button>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={onClose}
                    className="px-4 py-2 rounded-lg text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-[#1D283B] cursor-pointer transition-transform active:scale-95"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-xs font-semibold text-white cursor-pointer whitespace-nowrap transition-transform active:scale-95"
                  >
                    Apply
                  </button>
                </div>
              </div>
            </form>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
