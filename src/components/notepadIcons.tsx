/**
 * Local glyphs for the Notepad surfaces.
 *
 * Kept separate from the shared `icons.tsx` set on purpose so this feature
 * touches no shared file — same line/cap conventions (24px grid, currentColor,
 * 1.7 stroke) so it sits visually alongside the rest of the cockpit iconography.
 */
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

/** Notebook / scratchpad — the launcher mark. */
export const IconNotebook = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M6 3h11a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z" />
    <path d="M5 8H3M5 12H3M5 16H3" />
    <path d="M9.5 8.5h6M9.5 12h6M9.5 15.5h3.5" />
  </svg>
)

export const IconNotePin = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M12 17v4" />
    <path d="M9 3h6l-1 6 3 2.5V13H7v-1.5L10 9 9 3Z" />
  </svg>
)

export const IconNoteTrash = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M4 7h16" />
    <path d="M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
    <path d="M6 7l1 12a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-12" />
    <path d="M10 11v5M14 11v5" />
  </svg>
)

export const IconNoteClose = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M6 6l12 12M18 6 6 18" />
  </svg>
)

export const IconNoteSearch = (p: IconProps) => (
  <svg {...base(p)}>
    <circle cx="11" cy="11" r="6.5" />
    <path d="m20 20-3.5-3.5" />
  </svg>
)

/** Spark — the empty-state mark, hints at "capture a fresh idea". */
export const IconNoteSpark = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M12 3v4M12 17v4M3 12h4M17 12h4" />
    <path d="M12 8.5a3.5 3.5 0 0 0 3.5 3.5A3.5 3.5 0 0 0 12 15.5 3.5 3.5 0 0 0 8.5 12 3.5 3.5 0 0 0 12 8.5Z" />
  </svg>
)
