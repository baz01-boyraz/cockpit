import { useId, type SVGProps } from 'react'

type MarkProps = SVGProps<SVGSVGElement> & {
  title?: string
}

export function CockpitMark({ className = '', title, ...props }: MarkProps) {
  const uid = useId().replace(/:/g, '')
  const titleId = title ? `${uid}-title` : undefined
  const metalId = `${uid}-metal`
  const emberId = `${uid}-ember`
  const emberHotId = `${uid}-emberHot`
  const cyanId = `${uid}-cyan`
  const shadowId = `${uid}-shadow`

  return (
    <svg
      className={`cockpitMark ${className}`.trim()}
      viewBox="0 0 64 64"
      fill="none"
      role={title ? 'img' : undefined}
      aria-labelledby={titleId}
      aria-hidden={title ? undefined : true}
      focusable="false"
      {...props}
    >
      {title ? <title id={titleId}>{title}</title> : null}
      <defs>
        <linearGradient id={metalId} x1="14" y1="8" x2="42" y2="56" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="var(--surface-3)" />
          <stop offset="0.42" stopColor="var(--surface-2)" />
          <stop offset="1" stopColor="var(--surface-1)" />
        </linearGradient>
        <linearGradient id={emberId} x1="19" y1="58" x2="58" y2="16" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="var(--ember-600)" />
          <stop offset="0.45" stopColor="var(--accent)" />
          <stop offset="1" stopColor="var(--accent-hi)" />
        </linearGradient>
        <linearGradient id={emberHotId} x1="21" y1="33" x2="56" y2="18" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="var(--ember-100)" />
          <stop offset="0.32" stopColor="var(--accent-hi)" />
          <stop offset="1" stopColor="var(--accent)" />
        </linearGradient>
        <linearGradient id={cyanId} x1="14" y1="48" x2="47" y2="17" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="var(--glacier-400)" stopOpacity="0.95" />
          <stop offset="1" stopColor="var(--glacier-300)" stopOpacity="0.22" />
        </linearGradient>
        <filter id={shadowId} x="-18%" y="-18%" width="136%" height="140%" colorInterpolationFilters="sRGB">
          <feDropShadow dx="0" dy="2" stdDeviation="2.2" floodColor="#000" floodOpacity="0.5" />
          <feDropShadow dx="0" dy="0" stdDeviation="2.8" floodColor="var(--accent)" floodOpacity="0.22" />
        </filter>
      </defs>

      <path
        d="M17.4 52.4A29 29 0 0 1 12.5 23.2 29 29 0 0 1 36.8 6.6"
        stroke={`url(#${metalId})`}
        strokeWidth="7.5"
        strokeLinecap="butt"
        strokeDasharray="11 3.4 9 3.4 12 3.4 8 3.4"
      />
      <path
        d="M17.4 52.4A29 29 0 0 1 12.5 23.2 29 29 0 0 1 36.8 6.6"
        stroke="rgba(255,255,255,0.22)"
        strokeWidth="1"
        strokeLinecap="butt"
        strokeDasharray="11 10.2 12 14.2"
        opacity="0.7"
      />
      <path
        d="M15 45.4A29 29 0 0 0 27 57.1"
        stroke={`url(#${emberId})`}
        strokeWidth="7.5"
        strokeLinecap="butt"
        strokeDasharray="7.2 2.8 7.2"
        filter={`url(#${shadowId})`}
      />
      <path
        d="M18.4 47.1A22.5 22.5 0 0 1 47.8 16.9"
        stroke={`url(#${cyanId})`}
        strokeWidth="1.25"
        strokeLinecap="round"
        opacity="0.7"
      />
      <path
        d="M18.5 47.1A22.5 22.5 0 0 1 24.2 20.2"
        stroke="rgba(255,255,255,0.16)"
        strokeWidth="1"
        strokeLinecap="round"
        strokeDasharray="4 8"
      />

      <g filter={`url(#${shadowId})`}>
        <path
          d="M20.6 33.4 56.3 16.7 36.1 38.7 31.1 58.2 27.4 40.2Z"
          fill={`url(#${emberId})`}
          stroke="rgba(255,178,84,0.62)"
          strokeWidth="0.7"
          strokeLinejoin="round"
        />
        <path
          d="M20.6 33.4 56.3 16.7 35.8 31.7Z"
          fill={`url(#${emberHotId})`}
          opacity="0.98"
        />
        <path
          d="M35.8 31.7 56.3 16.7 36.1 38.7 31.1 58.2 33.1 39.4Z"
          fill="rgba(8,8,13,0.42)"
        />
        <path d="M27.4 40.2 36.1 38.7 31.1 58.2Z" fill="var(--ember-500)" opacity="0.9" />
      </g>
    </svg>
  )
}

type LockupProps = {
  className?: string
  markClassName?: string
  markTitle?: string
}

export function CockpitWordmark({ className = '' }: { className?: string }) {
  return (
    <span className={`cockpitWordmark ${className}`.trim()} aria-label="Cockpit">
      <span>Cockpi</span>
      <span className="cockpitWordmark__accent">t</span>
    </span>
  )
}

export function CockpitLockup({ className = '', markClassName = '', markTitle }: LockupProps) {
  return (
    <span className={`cockpitLockup ${className}`.trim()}>
      <CockpitMark className={markClassName} title={markTitle} />
      <CockpitWordmark />
    </span>
  )
}
