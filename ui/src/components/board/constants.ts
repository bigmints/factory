// ─── Board Constants & Configurations ───

export const storyStatusMap: Record<string, { label: string; bg: string; dot: string }> = {
  done:             { label: 'Done',          bg: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/25 font-semibold', dot: 'bg-emerald-500 shadow-[0_0_6px_rgba(52,211,153,0.5)]' },
  building:         { label: 'Building',      bg: 'bg-blue-500/15 text-blue-700 dark:text-blue-300 border-blue-500/25 font-semibold',            dot: 'bg-blue-500 shadow-[0_0_8px_rgba(96,165,250,0.8)] animate-pulse' },
  'ready-to-build': { label: 'Ready to Build',bg: 'bg-teal-500/15 text-teal-700 dark:text-teal-300 border-teal-500/25 font-semibold',            dot: 'bg-teal-500 shadow-[0_0_6px_rgba(45,212,191,0.5)]' },
  failed:           { label: 'Failed',        bg: 'bg-rose-500/15 text-rose-700 dark:text-rose-300 border-rose-500/25 font-semibold',            dot: 'bg-rose-500 shadow-[0_0_6px_rgba(248,113,113,0.5)]' },
  paused:           { label: 'Paused',        bg: 'bg-purple-500/15 text-purple-700 dark:text-purple-300 border-purple-500/25 font-semibold',   dot: 'bg-purple-500 shadow-[0_0_6px_rgba(192,132,252,0.5)]' },
  draft:            { label: 'Draft',         bg: 'bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/25 font-semibold',        dot: 'bg-amber-500 shadow-[0_0_6px_rgba(251,191,36,0.5)]' },
  unknown:          { label: 'Draft',         bg: 'bg-muted/50 border-border text-muted-foreground',                                              dot: 'bg-muted-foreground/60' }
};

export const epicStatusMap: Record<string, { label: string; bg: string }> = {
  done:             { label: 'Done',       bg: 'bg-emerald-500/15 border-emerald-500/25 text-emerald-700 dark:text-emerald-300' },
  building:         { label: 'Building',   bg: 'bg-blue-500/15 border-blue-500/25 text-blue-700 dark:text-blue-300' },
  paused:           { label: 'Paused',     bg: 'bg-rose-500/15 border-rose-500/25 text-rose-700 dark:text-rose-300' },
  'ready-to-build': { label: 'Ready',      bg: 'bg-muted/50 border-border text-muted-foreground' }
};

// Rotating palette of epic accent colors (border-left + badge tints)
export const EPIC_COLORS = [
  { border: 'border-l-violet-500',  badge: 'bg-violet-500/15 text-violet-700 dark:text-violet-300 border-violet-500/25 font-medium' },
  { border: 'border-l-sky-500',     badge: 'bg-sky-500/15 text-sky-700 dark:text-sky-300 border-sky-500/25 font-medium' },
  { border: 'border-l-emerald-500', badge: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/25 font-medium' },
  { border: 'border-l-rose-500',    badge: 'bg-rose-500/15 text-rose-700 dark:text-rose-300 border-rose-500/25 font-medium' },
  { border: 'border-l-teal-500',    badge: 'bg-teal-500/15 text-teal-700 dark:text-teal-300 border-teal-500/25 font-medium' },
  { border: 'border-l-fuchsia-500', badge: 'bg-fuchsia-500/15 text-fuchsia-700 dark:text-fuchsia-300 border-fuchsia-500/25 font-medium' },
  { border: 'border-l-amber-500',   badge: 'bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/25 font-medium' },
  { border: 'border-l-pink-500',    badge: 'bg-pink-500/15 text-pink-700 dark:text-pink-300 border-pink-500/25 font-medium' },
];

export const taskStatusMap: Record<string, { label: string; bg: string; dot: string }> = {
  done:             { label: 'Done',       bg: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/25', dot: 'bg-emerald-500' },
  building:         { label: 'Building',   bg: 'bg-blue-500/15 text-blue-700 dark:text-blue-400 border-blue-500/25',             dot: 'bg-blue-500 animate-pulse' },
  failed:           { label: 'Failed',     bg: 'bg-rose-500/15 text-rose-700 dark:text-rose-400 border-rose-500/25',             dot: 'bg-rose-500' },
  'ready-to-build': { label: 'Ready',      bg: 'bg-muted/50 text-muted-foreground border-border',                                dot: 'bg-muted-foreground' }
};

export const STATUS_SORT_ORDER: Record<string, number> = {
  building: 0, 'ready-to-build': 1, failed: 2, paused: 3,
  draft: 4, done: 5, unknown: 6,
};
