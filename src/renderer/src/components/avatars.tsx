import React from 'react';

export interface CartoonAvatar {
  id: string;
  label: string;
  bg: string;
  skin: string;
  hair: string;
  shirt: string;
  hairStyle:
    | 'shortPart'
    | 'curlyTop'
    | 'bob'
    | 'ponytail'
    | 'spiky'
    | 'bun'
    | 'wavyLong'
    | 'buzz'
    | 'sideSweep'
    | 'afro'
    | 'beanie'
    | 'pigtails';
  glasses?: 'round' | 'square';
  facialHair?: 'beard' | 'mustache';
  headset?: boolean;
  freckles?: boolean;
}

export const CARTOON_AVATARS: CartoonAvatar[] = [
  {
    id: 'alex',
    label: 'Alex',
    bg: '#DBEAFE',
    skin: '#F5C6A5',
    hair: '#2B2118',
    shirt: '#2563EB',
    hairStyle: 'shortPart',
    glasses: 'square',
  },
  {
    id: 'maya',
    label: 'Maya',
    bg: '#FCE7F3',
    skin: '#D99B72',
    hair: '#1E1B24',
    shirt: '#7C3AED',
    hairStyle: 'bob',
    glasses: 'round',
  },
  {
    id: 'liam',
    label: 'Liam',
    bg: '#DCFCE7',
    skin: '#F9D6BC',
    hair: '#B45309',
    shirt: '#059669',
    hairStyle: 'spiky',
    freckles: true,
  },
  {
    id: 'zoe',
    label: 'Zoe',
    bg: '#FEF3C7',
    skin: '#8D5524',
    hair: '#171717',
    shirt: '#D97706',
    hairStyle: 'afro',
    glasses: 'round',
  },
  {
    id: 'noah',
    label: 'Noah',
    bg: '#E0E7FF',
    skin: '#E0AC84',
    hair: '#27272A',
    shirt: '#4F46E5',
    hairStyle: 'curlyTop',
    facialHair: 'beard',
  },
  {
    id: 'chloe',
    label: 'Chloe',
    bg: '#CCFBF1',
    skin: '#FCD9C4',
    hair: '#92400E',
    shirt: '#0D9488',
    hairStyle: 'ponytail',
    headset: true,
  },
  {
    id: 'omar',
    label: 'Omar',
    bg: '#FFEDD5',
    skin: '#B67850',
    hair: '#18181B',
    shirt: '#EA580C',
    hairStyle: 'buzz',
    glasses: 'square',
    facialHair: 'mustache',
  },
  {
    id: 'hana',
    label: 'Hana',
    bg: '#F3E8FF',
    skin: '#F7D2B8',
    hair: '#1F2937',
    shirt: '#9333EA',
    hairStyle: 'bun',
    freckles: true,
  },
  {
    id: 'leo',
    label: 'Leo',
    bg: '#E0F2FE',
    skin: '#F2C09E',
    hair: '#D97706',
    shirt: '#0284C7',
    hairStyle: 'beanie',
    headset: true,
  },
  {
    id: 'priya',
    label: 'Priya',
    bg: '#FFE4E6',
    skin: '#A56943',
    hair: '#111827',
    shirt: '#E11D48',
    hairStyle: 'wavyLong',
    glasses: 'square',
  },
  {
    id: 'sam',
    label: 'Sam',
    bg: '#ECFCCB',
    skin: '#6F4228',
    hair: '#18181B',
    shirt: '#65A30D',
    hairStyle: 'sideSweep',
    facialHair: 'beard',
  },
  {
    id: 'nina',
    label: 'Nina',
    bg: '#FAE8FF',
    skin: '#F8D4BA',
    hair: '#DC2626',
    shirt: '#C026D3',
    hairStyle: 'pigtails',
    glasses: 'round',
  },
];

export const DEFAULT_AVATAR_ID = 'alex';

export interface SidebarProfile {
  name: string;
  title: string;
  avatar: string;
}

export const PROFILE_STORAGE_KEY = 'jsonprocedure_sidebar_profile';

export function resolveAvatarId(id: string | undefined): string {
  if (!id) return DEFAULT_AVATAR_ID;
  if (id === 'male') return 'alex';
  if (id === 'female') return 'maya';
  return CARTOON_AVATARS.some((a) => a.id === id) ? id : DEFAULT_AVATAR_ID;
}

/** True when the user has actually saved a profile in this browser (not just the defaults). */
export function hasSavedProfile(): boolean {
  try {
    return localStorage.getItem(PROFILE_STORAGE_KEY) !== null;
  } catch {
    return false;
  }
}

export function loadSavedProfile(fallbackTitle = 'Principal DBA'): SidebarProfile {
  try {
    const raw = localStorage.getItem(PROFILE_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<SidebarProfile>;
      return {
        name: parsed.name?.trim() || 'Database Admin',
        title: parsed.title?.trim() || fallbackTitle,
        avatar: resolveAvatarId(parsed.avatar),
      };
    }
  } catch {
    /* ignore storage errors */
  }
  return {
    name: 'Database Admin',
    title: fallbackTitle,
    avatar: DEFAULT_AVATAR_ID,
  };
}

export function saveSavedProfile(next: SidebarProfile): SidebarProfile {
  const cleaned: SidebarProfile = {
    name: next.name.trim() || 'Database Admin',
    title: next.title.trim() || 'Principal DBA',
    avatar: resolveAvatarId(next.avatar),
  };
  try {
    localStorage.setItem(PROFILE_STORAGE_KEY, JSON.stringify(cleaned));
  } catch {
    /* ignore storage errors */
  }
  return cleaned;
}

export const AvatarGraphic: React.FC<{
  avatarId: string;
  className?: string;
}> = ({ avatarId, className = 'h-8 w-8' }) => {
  const avatar =
    CARTOON_AVATARS.find((a) => a.id === resolveAvatarId(avatarId)) ?? CARTOON_AVATARS[0];

  return (
    <svg
      viewBox="0 0 64 64"
      className={`${className} rounded-full shrink-0 select-none`}
      role="img"
      aria-label={`${avatar.label} avatar`}
    >
      {/* Background */}
      <circle cx="32" cy="32" r="32" fill={avatar.bg} />

      {/* Back Hair Layers for Long/Pigtails/Bob/Afro */}
      {avatar.hairStyle === 'afro' && (
        <circle cx="32" cy="26" r="19" fill={avatar.hair} />
      )}
      {avatar.hairStyle === 'wavyLong' && (
        <path
          d="M15 28 C15 14, 49 14, 49 28 L51 50 C46 53, 18 53, 13 50 Z"
          fill={avatar.hair}
        />
      )}
      {avatar.hairStyle === 'bob' && (
        <path
          d="M16 27 C16 14, 48 14, 48 27 L49 42 C44 44, 20 44, 15 42 Z"
          fill={avatar.hair}
        />
      )}
      {avatar.hairStyle === 'ponytail' && (
        <path
          d="M44 21 C53 21, 55 34, 49 43 C46 39, 44 33, 44 27 Z"
          fill={avatar.hair}
        />
      )}
      {avatar.hairStyle === 'bun' && (
        <circle cx="32" cy="12" r="8" fill={avatar.hair} />
      )}
      {avatar.hairStyle === 'pigtails' && (
        <>
          <circle cx="14" cy="30" r="6" fill={avatar.hair} />
          <circle cx="50" cy="30" r="6" fill={avatar.hair} />
        </>
      )}

      {/* Shoulders / Shirt */}
      <path
        d="M11 64 C12 49, 21 45, 32 45 C43 45, 52 49, 53 64 Z"
        fill={avatar.shirt}
      />
      {/* Shirt collar highlight */}
      <path
        d="M25 46 L32 52 L39 46"
        fill="none"
        stroke="rgba(255,255,255,0.45)"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      {/* Neck */}
      <rect x="27" y="39" width="10" height="9" rx="4" fill={avatar.skin} />
      <path d="M27 41 Q32 45 37 41" fill="rgba(0,0,0,0.12)" />

      {/* Ears */}
      <circle cx="18.5" cy="30" r="3.5" fill={avatar.skin} />
      <circle cx="45.5" cy="30" r="3.5" fill={avatar.skin} />

      {/* Head */}
      <rect x="19" y="16" width="26" height="27" rx="13" fill={avatar.skin} />

      {/* Cheeks */}
      <circle cx="23.5" cy="33" r="2.2" fill="rgba(244, 63, 94, 0.22)" />
      <circle cx="40.5" cy="33" r="2.2" fill="rgba(244, 63, 94, 0.22)" />

      {/* Freckles */}
      {avatar.freckles && (
        <g fill="rgba(146, 64, 14, 0.45)">
          <circle cx="22.5" cy="31.5" r="0.6" />
          <circle cx="24.5" cy="32.2" r="0.6" />
          <circle cx="39.5" cy="32.2" r="0.6" />
          <circle cx="41.5" cy="31.5" r="0.6" />
        </g>
      )}

      {/* Eyes */}
      <circle cx="27" cy="29" r="2" fill="#1E293B" />
      <circle cx="37" cy="29" r="2" fill="#1E293B" />
      <circle cx="27.6" cy="28.3" r="0.65" fill="#FFFFFF" />
      <circle cx="37.6" cy="28.3" r="0.65" fill="#FFFFFF" />

      {/* Eyebrows */}
      <path
        d="M24 25 Q27 23.5 30 25"
        fill="none"
        stroke={avatar.hair}
        strokeWidth="1.6"
        strokeLinecap="round"
      />
      <path
        d="M34 25 Q37 23.5 40 25"
        fill="none"
        stroke={avatar.hair}
        strokeWidth="1.6"
        strokeLinecap="round"
      />

      {/* Nose */}
      <path
        d="M32 30 L31 33.5 L33 33.5"
        fill="none"
        stroke="rgba(0,0,0,0.22)"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      {/* Facial Hair */}
      {avatar.facialHair === 'beard' && (
        <path
          d="M19.5 33 C20 42, 26 44.5, 32 44.5 C38 44.5, 44 42, 44.5 33 C42 36.5, 37.5 38, 32 38 C26.5 38, 22 36.5, 19.5 33 Z"
          fill={avatar.hair}
          opacity="0.92"
        />
      )}
      {avatar.facialHair === 'mustache' && (
        <path
          d="M26 35.5 Q29 33.8 32 35.2 Q35 33.8 38 35.5"
          fill="none"
          stroke={avatar.hair}
          strokeWidth="2.2"
          strokeLinecap="round"
        />
      )}

      {/* Smile */}
      <path
        d="M28 36.5 Q32 39.5 36 36.5"
        fill="none"
        stroke={avatar.facialHair === 'beard' ? '#FFFFFF' : '#7C2D12'}
        strokeWidth="1.7"
        strokeLinecap="round"
      />

      {/* Glasses */}
      {avatar.glasses === 'round' && (
        <g fill="none" stroke="#1E293B" strokeWidth="1.6">
          <circle cx="27" cy="29" r="4.3" />
          <circle cx="37" cy="29" r="4.3" />
          <line x1="31.3" y1="29" x2="32.7" y2="29" />
        </g>
      )}
      {avatar.glasses === 'square' && (
        <g fill="none" stroke="#1E293B" strokeWidth="1.6">
          <rect x="22.3" y="25.5" width="9" height="6.8" rx="1.8" />
          <rect x="32.7" y="25.5" width="9" height="6.8" rx="1.8" />
          <line x1="31.3" y1="28.5" x2="32.7" y2="28.5" />
        </g>
      )}

      {/* Front Hair Styles */}
      {avatar.hairStyle === 'shortPart' && (
        <path
          d="M18 27 C17 17, 25 13, 33 13 C41 13, 47 18, 46 27 C43 21, 36 20, 29 21 C24 22, 20 23, 18 27 Z"
          fill={avatar.hair}
        />
      )}
      {avatar.hairStyle === 'curlyTop' && (
        <g fill={avatar.hair}>
          <circle cx="23" cy="18" r="5" />
          <circle cx="30" cy="15.5" r="5.5" />
          <circle cx="38" cy="16.5" r="5.2" />
          <circle cx="43" cy="20" r="4.2" />
        </g>
      )}
      {avatar.hairStyle === 'spiky' && (
        <path
          d="M18 26 L20 17 L25 20 L29 12 L34 18 L39 13 L43 19 L46 26 C42 21, 22 21, 18 26 Z"
          fill={avatar.hair}
        />
      )}
      {(avatar.hairStyle === 'bob' ||
        avatar.hairStyle === 'ponytail' ||
        avatar.hairStyle === 'bun' ||
        avatar.hairStyle === 'wavyLong' ||
        avatar.hairStyle === 'pigtails') && (
        <path
          d="M18 26 C18 15, 46 15, 46 26 C42 20, 35 19, 31 22 C26 19, 21 21, 18 26 Z"
          fill={avatar.hair}
        />
      )}
      {avatar.hairStyle === 'buzz' && (
        <path
          d="M19 25 C19 16, 45 16, 45 25 C42 21, 22 21, 19 25 Z"
          fill={avatar.hair}
        />
      )}
      {avatar.hairStyle === 'sideSweep' && (
        <path
          d="M18 26 C18 15, 45 14, 46 25 C40 19, 29 22, 18 26 Z"
          fill={avatar.hair}
        />
      )}
      {avatar.hairStyle === 'beanie' && (
        <g>
          <path
            d="M17.5 23 C18 13, 46 13, 46.5 23 Z"
            fill={avatar.shirt}
          />
          <rect
            x="16.5"
            y="20.5"
            width="31"
            height="5"
            rx="2.5"
            fill={avatar.hair}
          />
          <circle cx="32" cy="12" r="3.2" fill={avatar.shirt} />
        </g>
      )}

      {/* Headset accessory */}
      {avatar.headset && (
        <g>
          <path
            d="M16.5 29 C16.5 16, 47.5 16, 47.5 29"
            fill="none"
            stroke="#334155"
            strokeWidth="2.4"
            strokeLinecap="round"
          />
          <rect x="14.5" y="26.5" width="4" height="8" rx="2" fill="#1E293B" />
          <rect x="45.5" y="26.5" width="4" height="8" rx="2" fill="#1E293B" />
          <path
            d="M16.5 34 Q19 39 26 39"
            fill="none"
            stroke="#334155"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
        </g>
      )}
    </svg>
  );
};
