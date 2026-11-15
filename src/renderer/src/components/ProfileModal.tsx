import React, { useEffect, useState } from 'react';
import { Check, Save, UserCog, X } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import {
  AvatarGraphic,
  CARTOON_AVATARS,
  type SidebarProfile,
} from './avatars';

interface ProfileModalProps {
  open: boolean;
  profile: SidebarProfile;
  onClose: () => void;
  onSave: (next: SidebarProfile) => void;
}

export const ProfileModal: React.FC<ProfileModalProps> = ({
  open,
  profile,
  onClose,
  onSave,
}) => {
  const [name, setName] = useState(profile.name);
  const [title, setTitle] = useState(profile.title);
  const [avatar, setAvatar] = useState(profile.avatar);

  useEffect(() => {
    if (open) {
      setName(profile.name);
      setTitle(profile.title);
      setAvatar(profile.avatar);
    }
  }, [open, profile]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave({ name, title, avatar });
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
          aria-labelledby="profile-modal-title"
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
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-[#E2E8F0] dark:border-[#243147]">
              <div className="flex items-center gap-2.5">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-50 dark:bg-blue-950/60 border border-blue-200/70 dark:border-blue-800/70 text-blue-600 dark:text-blue-400">
                  <UserCog className="h-4 w-4" />
                </div>
                <h2
                  id="profile-modal-title"
                  className="font-display text-base font-semibold text-[#172033] dark:text-[#F1F5F9]"
                >
                  Edit profile
                </h2>
              </div>

              <button
                type="button"
                onClick={onClose}
                aria-label="Close modal"
                className="inline-flex items-center gap-1 rounded-lg border border-[#E2E8F0] dark:border-[#2C3A52] px-2.5 py-1 text-xs font-medium text-slate-500 hover:bg-slate-100 dark:hover:bg-[#1D283B] cursor-pointer transition-transform active:scale-95"
              >
                <X className="h-3.5 w-3.5" />
                <span>Close</span>
              </button>
            </div>

            {/* Form */}
            <form onSubmit={handleSubmit} className="p-6 space-y-5">
              {/* Preview strip */}
              <div className="flex items-center gap-3.5 rounded-xl border border-[#E6EBF2] dark:border-[#243147] bg-[#FAFBFD] dark:bg-[#111927]/50 p-3.5">
                <motion.div
                  key={avatar}
                  initial={{ scale: 0.9, rotate: -4 }}
                  animate={{ scale: 1, rotate: 0 }}
                  transition={{ type: 'spring', stiffness: 400, damping: 24 }}
                >
                  <AvatarGraphic
                    avatarId={avatar}
                    className="h-12 w-12 ring-2 ring-blue-500/20"
                  />
                </motion.div>
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-[#172033] dark:text-[#F1F5F9] truncate">
                    {name.trim() || 'Database Admin'}
                  </div>
                  <div className="text-xs text-slate-500 dark:text-slate-400 truncate">
                    {title.trim() || 'Principal DBA'}
                  </div>
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label
                    htmlFor="modal-profile-name"
                    className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1.5"
                  >
                    Display name
                  </label>
                  <input
                    id="modal-profile-name"
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    autoFocus
                    placeholder="Database Admin"
                    className="w-full rounded-lg border border-[#D8E1EC] dark:border-[#2C3A52] bg-[#F8FAFC] dark:bg-[#1D283B] px-3 py-2 text-sm text-[#172033] dark:text-[#F1F5F9] focus:outline-none focus:ring-2 focus:ring-blue-500/25 focus:border-blue-600"
                  />
                </div>

                <div>
                  <label
                    htmlFor="modal-profile-title"
                    className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1.5"
                  >
                    Role / Title
                  </label>
                  <input
                    id="modal-profile-title"
                    type="text"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="Principal DBA"
                    className="w-full rounded-lg border border-[#D8E1EC] dark:border-[#2C3A52] bg-[#F8FAFC] dark:bg-[#1D283B] px-3 py-2 text-sm text-[#172033] dark:text-[#F1F5F9] focus:outline-none focus:ring-2 focus:ring-blue-500/25 focus:border-blue-600"
                  />
                </div>
              </div>

              {/* Cartoony Avatar Grid */}
              <div>
                <div className="mb-2">
                  <span className="text-xs font-medium text-slate-600 dark:text-slate-300">
                    Choose avatar ({CARTOON_AVATARS.length})
                  </span>
                </div>
                <div className="grid grid-cols-4 sm:grid-cols-6 gap-2.5 max-h-56 overflow-y-auto p-1">
                  {CARTOON_AVATARS.map((item, idx) => {
                    const selected = avatar === item.id;
                    return (
                      <motion.button
                        key={item.id}
                        type="button"
                        whileHover={{ y: -2, scale: 1.03 }}
                        whileTap={{ scale: 0.94 }}
                        transition={{ duration: 0.14 }}
                        onClick={() => setAvatar(item.id)}
                        aria-label={`Select avatar ${idx + 1}`}
                        className={`relative flex items-center justify-center p-2 rounded-xl border transition-colors cursor-pointer ${
                          selected
                            ? 'border-blue-600 bg-blue-50/90 dark:bg-blue-950/50 dark:border-blue-500 ring-2 ring-blue-500/20'
                            : 'border-[#E6EBF2] dark:border-[#243147] bg-[#FAFBFD] dark:bg-[#1D283B]/60 hover:border-blue-400/60'
                        }`}
                      >
                        <AvatarGraphic avatarId={item.id} className="h-12 w-12" />
                        {selected && (
                          <motion.span
                            initial={{ scale: 0 }}
                            animate={{ scale: 1 }}
                            className="absolute top-1 right-1 flex h-4 w-4 items-center justify-center rounded-full bg-blue-600 text-white"
                          >
                            <Check className="h-2.5 w-2.5" />
                          </motion.span>
                        )}
                      </motion.button>
                    );
                  })}
                </div>
              </div>

              {/* Footer Actions */}
              <div className="flex justify-end gap-2 pt-3 border-t border-[#E2E8F0] dark:border-[#243147]">
                <button
                  type="button"
                  onClick={onClose}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg border border-[#E2E8F0] dark:border-[#2C3A52] text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-[#1D283B] cursor-pointer transition-transform active:scale-95"
                >
                  <X className="h-3.5 w-3.5" />
                  <span>Cancel</span>
                </button>
                <button
                  type="submit"
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-xs font-semibold text-white cursor-pointer transition-transform active:scale-95"
                >
                  <Save className="h-3.5 w-3.5" />
                  <span>Save profile</span>
                </button>
              </div>
            </form>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
