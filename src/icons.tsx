// One consistent line-icon set for the whole app (24×24 grid, 1.75 stroke, currentColor).
// Icons replace the mix of emojis and Unicode glyphs; tones give every game its own accent colour.
import type { ReactNode } from "react";

const paths = {
  home: <path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" />,
  quiz: <><circle cx="12" cy="12" r="9" /><path d="M9.6 9.2a2.5 2.5 0 1 1 3.4 2.3c-.6.3-1 .9-1 1.6v.6M12 17h.01" /></>,
  flag: <path d="M5 21V4M5 4h12l-2.5 4.5L17 13H5" />,
  capital: <path d="M3 21h18M5 21v-9M9.7 21v-9M14.3 21v-9M19 21v-9M3 9.5 12 4l9 5.5z" />,
  recall: <path d="m3.5 6 1.5 1.5L7.5 5M3.5 12l1.5 1.5 2.5-2.5M3.5 18l1.5 1.5 2.5-2.5M11 6.5h9.5M11 12.5h9.5M11 18.5h6" />,
  explorer: <><circle cx="12" cy="12" r="9" /><path d="m15.5 8.5-2 5-5 2 2-5z" /></>,
  globe: <><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3c2.5 2.6 3.7 5.6 3.7 9s-1.2 6.4-3.7 9c-2.5-2.6-3.7-5.6-3.7-9S9.5 5.6 12 3z" /></>,
  map: <path d="m9 4-6 2v14l6-2 6 2 6-2V4l-6 2zM9 4v14M15 6v14" />,
  calendar: <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 10h18M8 3v4M16 3v4" /></>,
  review: <path d="m17 2 3 3-3 3M4 11V9a4 4 0 0 1 4-4h12M7 22l-3-3 3-3M20 13v2a4 4 0 0 1-4 4H4" />,
  medal: <><circle cx="12" cy="9" r="6" /><path d="M8.6 14 7 22l5-3 5 3-1.6-8" /></>,
  trophy: <path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0zM17 5.5h3v1.5a3.5 3.5 0 0 1-3.2 3.5M7 5.5H4v1.5a3.5 3.5 0 0 0 3.2 3.5" />,
  flame: <path d="M12 3c.7 3.3 5 5.4 5 10.2a5 5 0 0 1-10 0c0-2.6 1.3-4.2 2.6-5.2.1 1.8.9 2.9 2 3.1-.3-2.9-.6-5.3.4-8.1z" />,
  target: <><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="5" /><circle cx="12" cy="12" r="1" /></>,
  zap: <path d="M13 2 4 14h7l-1 8 9-12h-7z" />,
  infinity: <path d="M12 12c-1.8-2.4-3.4-3.6-5-3.6a3.6 3.6 0 0 0 0 7.2c1.6 0 3.2-1.2 5-3.6zm0 0c1.8 2.4 3.4 3.6 5 3.6a3.6 3.6 0 0 0 0-7.2c-1.6 0-3.2 1.2-5 3.6z" />,
  timer: <><circle cx="12" cy="13.5" r="7.5" /><path d="M12 9.5v4l2.5 2M9.5 2.5h5M12 2.5V6" /></>,
  practice: <path d="M2.5 5H8a4 4 0 0 1 4 4v11.5a3 3 0 0 0-3-3H2.5zM21.5 5H16a4 4 0 0 0-4 4v11.5a3 3 0 0 1 3-3h6.5z" />,
  gem: <path d="M6.5 3h11L22 9l-10 12L2 9zM2 9h20M12 21 8.5 9l2-6M12 21l3.5-12-2-6" />,
  crown: <path d="M3.5 19h17M4.5 16 3 7l5 4 4-7 4 7 5-4-1.5 9z" />,
  star: <path d="m12 2.8 2.8 5.7 6.3.9-4.6 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2-4.6-4.4 6.3-.9z" />,
  mountain: <path d="m2.5 20 7-12.5 4.2 7.2 2.3-3.7 5.5 9z" />,
  languages: <path d="M4 4.5h16v11H10l-6 4.5zM8 8.5h8M8 11.5h5" />,
  layers: <path d="M12 3 2 8l10 5 10-5zM2 12.5l10 5 10-5M2 17l10 5 10-5" />,
  trending: <path d="m3 17 6-6 4 4 8-8M15 7h6v6" />,
  sparkles: <path d="m12 3 1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM19 16l.7 1.8 1.8.7-1.8.7L19 21l-.7-1.8-1.8-.7 1.8-.7z" />,
  compass: <><circle cx="12" cy="12" r="9" /><path d="m15.5 8.5-2 5-5 2 2-5zM12 3v2M12 19v2M3 12h2M19 12h2" /></>,
  users: <><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 4.6a3.5 3.5 0 0 1 0 6.8M18 14.2a5.5 5.5 0 0 1 3.5 5.8" /></>,
  ruler: <path d="M3 17 17 3l4 4L7 21zM7.5 12.5l2 2M10.5 9.5l2 2M13.5 6.5l2 2" />,
  coins: <><circle cx="9" cy="9" r="6" /><path d="M15.4 9.6A6 6 0 1 1 9.6 15.4M9 6.5v5M7.5 8h3" /></>,
  phone: <path d="M5 3h3.5l2 5-2.4 1.6a11 11 0 0 0 6.3 6.3L16 13.5l5 2V19a2 2 0 0 1-2 2A16 16 0 0 1 3 5a2 2 0 0 1 2-2z" />,
  search: <><circle cx="11" cy="11" r="7" /><path d="m20 20-4-4" /></>,
  gamepad: <path d="M6.5 7.5h11a4.5 4.5 0 0 1 4.5 4.5v1a4 4 0 0 1-7.2 2.4l-.8-.9h-4l-.8.9A4 4 0 0 1 2 13v-1a4.5 4.5 0 0 1 4.5-4.5zM7.5 10.5v3M6 12h3M15.5 11h.01M17.5 13h.01" />,
  lock: <><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V7.5a4 4 0 0 1 8 0V11" /></>,
  check: <path d="m4.5 12.5 5 5 10-11" />,
  sun: <><circle cx="12" cy="12" r="4" /><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4" /></>,
  moon: <path d="M20 14.5A8.5 8.5 0 1 1 9.5 4 6.8 6.8 0 0 0 20 14.5z" />,
  monitor: <><rect x="3" y="4" width="18" height="12" rx="2" /><path d="M8 20h8M12 16v4" /></>,
  shield: <path d="M12 3 4.5 6v5.5c0 4.6 3.1 8.2 7.5 9.5 4.4-1.3 7.5-4.9 7.5-9.5V6zM8.5 12l2.5 2.5 4.5-5" />,
  rocket: <path d="M14.5 4.5c2.6-1.4 5-1.5 6-1.5 0 1-.1 3.4-1.5 6l-6.5 6.5-5-5zM8 10.5 4.5 10 2 12.5l4.5 1M13.5 16l.5 3.5-2.5 2.5-1-4.5M6 17c-1.5.5-2.5 2-2.5 3.5C5 20.5 6.5 19.5 7 18M15.5 8.5h.01" />,
  hourglass: <path d="M6 3h12M6 21h12M7 3v2.5c0 2.5 5 4 5 6.5s-5 4-5 6.5V21M17 3v2.5c0 2.5-5 4-5 6.5s5 4 5 6.5V21" />,
  book: <path d="M5 4.5A1.5 1.5 0 0 1 6.5 3H20v15H6.5A1.5 1.5 0 0 0 5 19.5zM5 19.5A1.5 1.5 0 0 0 6.5 21H20M9 7.5h7" />,
  podium: <path d="M3 21V14h6v7M9 21V9h6v12M15 21v-5h6v5M3 21h18M12 3.5l.9 1.8 2 .3-1.4 1.4.3 2-1.8-.9-1.8.9.3-2-1.4-1.4 2-.3z" />,
  funnel: <path d="M3 4.5h18l-7 8.2v6.3l-4 2v-8.3z" />,
  checkCircle: <><circle cx="12" cy="12" r="9" /><path d="m8 12.5 2.8 2.8L16.5 9.5" /></>,
  warning: <path d="M12 3.5 2.5 20h19zM12 10v4.5M12 17.5h.01" />,
  settings: <><path d="M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1" /><circle cx="15" cy="6" r="2" /><circle cx="9" cy="12" r="2" /><circle cx="17" cy="18" r="2" /></>,
  user: <><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></>,
  chevronLeft: <path d="m15 5-7 7 7 7" />,
  chevronRight: <path d="m9 5 7 7-7 7" />,
  close: <path d="M6 6l12 12M18 6 6 18" />,
} satisfies Record<string, ReactNode>;

export type IconName = keyof typeof paths;
export const iconNames = Object.keys(paths) as IconName[];

export function Icon({ name, size = 20, className, label }: { name: IconName; size?: number; className?: string; label?: string }) {
  return (
    <svg className={`icon${className ? ` ${className}` : ""}`} width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round"
      role={label ? "img" : undefined} aria-label={label} aria-hidden={label ? undefined : true} focusable="false">
      {paths[name] ?? paths.star}
    </svg>
  );
}

/** Accent colour per game / feature. */
export type Tone = "elimination" | "quiz" | "flags" | "capitals" | "recall" | "explorer" | "daily" | "review" | "awards" | "neutral";

/** Rounded square with a tinted background and a coloured icon – used for games, modes and feature cards. */
export function IconTile({ name, tone, size = "md" }: { name: IconName; tone: Tone; size?: "sm" | "md" | "lg" }) {
  const px = size === "lg" ? 26 : size === "sm" ? 16 : 21;
  return <span className={`icon-tile icon-tile-${size} tone-${tone}`} aria-hidden="true"><Icon name={name} size={px} /></span>;
}

/** Icon + tone for each game, so every screen shows a game the same way. */
export const games = {
  quiz: { icon: "quiz", tone: "quiz" },
  flags: { icon: "flag", tone: "flags" },
  capitals: { icon: "capital", tone: "capitals" },
  recall: { icon: "recall", tone: "recall" },
  explorer: { icon: "explorer", tone: "explorer" },
  elimination: { icon: "funnel", tone: "elimination" },
  daily: { icon: "calendar", tone: "daily" },
  review: { icon: "review", tone: "review" },
  achievements: { icon: "medal", tone: "awards" },
} as const satisfies Record<string, { icon: IconName; tone: Tone }>;
