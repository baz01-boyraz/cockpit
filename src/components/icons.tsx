import type { SVGProps } from 'react'

type IconProps = SVGProps<SVGSVGElement>

const base = (props: IconProps): IconProps => ({
  width: 16,
  height: 16,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.7,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  ...props,
})

export const IconDashboard = (p: IconProps) => (
  <svg {...base(p)}>
    <rect x="4" y="4" width="6.5" height="7" rx="1.4" />
    <rect x="13.5" y="4" width="6.5" height="5" rx="1.4" />
    <rect x="4" y="14" width="6.5" height="6" rx="1.4" />
    <rect x="13.5" y="12" width="6.5" height="8" rx="1.4" />
  </svg>
)

/** Orbiting clock: calm background stewardship, distinct from terminals/jobs. */
export const IconAutomation = (p: IconProps) => (
  <svg {...base(p)}>
    <circle cx="12" cy="12" r="6.5" />
    <path d="M12 8.2v4l2.7 1.6" />
    <path d="M4.5 7.3A9 9 0 0 1 18 4.5" />
    <path d="m17.9 2.9.2 3.4-3.4.2" />
    <path d="M19.5 16.7A9 9 0 0 1 6 19.5" />
    <path d="m6.1 21.1-.2-3.4 3.4-.2" />
  </svg>
)

export const IconTerminal = (p: IconProps) => (
  <svg {...base(p)}>
    <rect x="3.5" y="5" width="17" height="14" rx="2.2" />
    <path d="M3.5 9h17" />
    <path d="m7.2 12 2.8 2.3-2.8 2.3" />
    <path d="M13 16.5h3.8" />
  </svg>
)

export const IconGrid = (p: IconProps) => (
  <svg {...base(p)}>
    <rect x="4" y="4" width="7" height="7" rx="1.5" />
    <rect x="13" y="4" width="7" height="7" rx="1.5" />
    <rect x="4" y="13" width="7" height="7" rx="1.5" />
    <rect x="13" y="13" width="7" height="7" rx="1.5" />
  </svg>
)

export const IconFocus = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M8 3H4a1 1 0 0 0-1 1v4" />
    <path d="M16 3h4a1 1 0 0 1 1 1v4" />
    <path d="M21 16v4a1 1 0 0 1-1 1h-4" />
    <path d="M8 21H4a1 1 0 0 1-1-1v-4" />
    <rect x="8" y="8" width="8" height="8" rx="1.5" />
  </svg>
)

export const IconLayoutAuto = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M4 7h16" />
    <path d="M4 17h16" />
    <circle cx="9" cy="7" r="2" />
    <circle cx="15" cy="17" r="2" />
  </svg>
)

export const IconGit = (p: IconProps) => (
  <svg {...base(p)}>
    <circle cx="6" cy="5.5" r="2.2" />
    <circle cx="6" cy="18.5" r="2.2" />
    <circle cx="18" cy="8.5" r="2.2" />
    <path d="M6 7.7v8.6" />
    <path d="M8.1 12.5h3.4c3.8 0 6.5-1.2 6.5-3.9" />
  </svg>
)

export const IconRailway = (p: IconProps) => (
  <svg {...base(p)}>
    <rect x="7" y="4" width="10" height="5" rx="1.5" />
    <path d="M12 9v4.5" />
    <path d="M5.5 19v-2.2a3.3 3.3 0 0 1 3.3-3.3h6.4a3.3 3.3 0 0 1 3.3 3.3V19" />
    <circle cx="5.5" cy="19" r="1.6" />
    <circle cx="12" cy="19" r="1.6" />
    <circle cx="18.5" cy="19" r="1.6" />
  </svg>
)

export const IconLogs = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M4 5.5h16M4 10h12M4 14.5h10M4 19h8" />
    <path d="M18 14.5 21 20h-6z" />
    <path d="M18 17v.01" />
  </svg>
)

export const IconUsage = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M5 18.5V6" />
    <path d="M5 18.5h14" />
    <path d="M8.5 18.5v-4M12 18.5v-7M15.5 18.5v-5.5" />
    <path d="M8 9.5a5 5 0 0 1 8 0" />
  </svg>
)

export const IconSettings = (p: IconProps) => (
  <svg {...base(p)}>
    <circle cx="12" cy="12" r="7.5" />
    <circle cx="12" cy="12" r="2.2" />
    <path d="M12 4.5v2M12 17.5v2M4.5 12h2M17.5 12h2" />
    <path d="m13.6 10.4 3.2-3.2" />
  </svg>
)

export const IconPlus = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M12 5v14M5 12h14" />
  </svg>
)

export const IconSearch = (p: IconProps) => (
  <svg {...base(p)}>
    <circle cx="11" cy="11" r="7" />
    <path d="m20 20-3.2-3.2" />
  </svg>
)

export const IconBolt = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M13 2 4 14h7l-1 8 9-12h-7z" />
  </svg>
)

export const IconCheck = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="m4 12 5 5L20 6" />
  </svg>
)

export const IconX = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M6 6l12 12M18 6 6 18" />
  </svg>
)

export const IconCopy = (p: IconProps) => (
  <svg {...base(p)}>
    <rect x="9" y="9" width="11" height="11" rx="2" />
    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
  </svg>
)

export const IconChevron = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="m9 6 6 6-6 6" />
  </svg>
)

export const IconWarning = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M12 3 2 20h20z" />
    <path d="M12 10v4M12 17h.01" />
  </svg>
)

export const IconShield = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M12 3 5 6v5c0 4 3 7 7 9 4-2 7-5 7-9V6z" />
    <path d="m9 12 2 2 4-4" />
  </svg>
)

export const IconSend = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M5 12h14M13 6l6 6-6 6" />
  </svg>
)

/** Sentinel bell — the always-on signal feed affordance. */
export const IconBell = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M6 9a6 6 0 0 1 12 0c0 4 1.2 5.4 2 6.4.5.6 0 1.6-.8 1.6H4.8c-.8 0-1.3-1-.8-1.6.8-1 2-2.4 2-6.4Z" />
    <path d="M10.2 20a2 2 0 0 0 3.6 0" />
  </svg>
)

export const IconRestart = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M4 5v5h5" />
    <path d="M5 12a7 7 0 1 0 2-5.5L4 10" />
  </svg>
)

export const IconFolder = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
  </svg>
)

export const IconImage = (p: IconProps) => (
  <svg {...base(p)}>
    <rect x="3" y="5" width="18" height="14" rx="2" />
    <circle cx="8" cy="10" r="1.5" />
    <path d="m5 17 4.5-4.5 3 3L15 13l4 4" />
  </svg>
)

export const IconBranch = (p: IconProps) => (
  <svg {...base(p)}>
    <circle cx="6" cy="5" r="2.2" />
    <circle cx="6" cy="19" r="2.2" />
    <circle cx="18" cy="9" r="2.2" />
    <path d="M6 7.2v9.6M18 11.2c0 4-6 2-6 6" />
  </svg>
)

export const IconCloud = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M7 18h10a4 4 0 0 0 .6-8A6 6 0 0 0 6.2 8.4 4.5 4.5 0 0 0 7 18z" />
  </svg>
)

export const IconDownload = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M12 3v11" />
    <path d="m7 10 5 5 5-5" />
    <path d="M5 20h14" />
  </svg>
)

export const IconUpload = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M12 15V4" />
    <path d="m7 9 5-5 5 5" />
    <path d="M5 20h14" />
  </svg>
)

export const IconPlay = (p: IconProps) => (
  <svg {...base(p)} fill="currentColor" stroke="none">
    <path d="M7 4.5v15a1 1 0 0 0 1.54.84l11.5-7.5a1 1 0 0 0 0-1.68L8.54 3.66A1 1 0 0 0 7 4.5Z" />
  </svg>
)

export const IconStop = (p: IconProps) => (
  <svg {...base(p)} fill="currentColor" stroke="none">
    <rect x="6" y="6" width="12" height="12" rx="2.5" />
  </svg>
)

export const IconPause = (p: IconProps) => (
  <svg {...base(p)} fill="currentColor" stroke="none">
    <rect x="6.2" y="4.5" width="4.2" height="15" rx="1.6" />
    <rect x="13.6" y="4.5" width="4.2" height="15" rx="1.6" />
  </svg>
)

export const IconServer = (p: IconProps) => (
  <svg {...base(p)}>
    <rect x="3" y="4" width="18" height="7" rx="2" />
    <rect x="3" y="13" width="18" height="7" rx="2" />
    <path d="M7 7.5h.01" />
    <path d="M7 16.5h.01" />
  </svg>
)

export const IconBeaker = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M9 3h6" />
    <path d="M10 3v6.5L5.2 17a2 2 0 0 0 1.7 3h10.2a2 2 0 0 0 1.7-3L14 9.5V3" />
    <path d="M7.5 14h9" />
  </svg>
)

/* Three linked nodes: the per-project knowledge hub (memory graph). Distinct
 * from IconGit/IconBranch — a closed triangle, not a branch fork. */
export const IconMemory = (p: IconProps) => (
  <svg {...base(p)}>
    <circle cx="12" cy="5.5" r="2" />
    <circle cx="6" cy="16.8" r="2" />
    <circle cx="18" cy="16.8" r="2" />
    <circle cx="12" cy="12" r="1.7" />
    <path d="M11.1 7.3 8 15M12.9 7.3 16 15M7.9 16.8h8.2M12 10.3V7.5" />
  </svg>
)

/* Three kanban columns at staggered fills: the swarm board, where cards drive
 * agents. Distinct from IconDashboard (2×2 grid) — vertical lanes, not tiles. */
export const IconSwarm = (p: IconProps) => (
  <svg {...base(p)}>
    <rect x="4" y="4" width="4.6" height="16" rx="1.2" />
    <rect x="9.7" y="4" width="4.6" height="16" rx="1.2" />
    <rect x="15.4" y="4" width="4.6" height="16" rx="1.2" />
    <path d="M6.3 9.5h5.7c1.4 0 2.3 1 2.3 2.2v2.8" />
  </svg>
)

/* Shield + magnifier: the pre-ship AI review action. Distinct from IconShield
 * (shield-check), which the Git panel already uses for force-push gating. */
export const IconShieldSearch = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M12 3 5 6v5c0 4 3 7 7 9 4-2 7-5 7-9V6z" />
    <circle cx="11" cy="10.5" r="2.4" />
    <path d="m12.8 12.3 2.2 2.2" />
  </svg>
)

/* Three overlapping lenses: the reviewer council — the same diff judged
 * through several personas. Distinct from IconMemory (linked nodes). */
export const IconCouncil = (p: IconProps) => (
  <svg {...base(p)}>
    <circle cx="8.6" cy="9" r="4.6" />
    <circle cx="15.4" cy="9" r="4.6" />
    <circle cx="12" cy="14.8" r="4.6" />
  </svg>
)
