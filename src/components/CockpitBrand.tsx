import { useId, type SVGProps } from 'react'

type MarkProps = SVGProps<SVGSVGElement> & {
  title?: string
}

export function CockpitMark({ className = '', title, ...props }: MarkProps) {
  const uid = useId().replace(/:/g, '')
  const titleId = title ? `${uid}-title` : undefined
  const rimId = `${uid}-rim`
  const emberId = `${uid}-ember`
  const emberHotId = `${uid}-emberHot`
  const glassId = `${uid}-glass`
  const coreId = `${uid}-core`
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
        <linearGradient id={rimId} x1="13" y1="9" x2="46" y2="58" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="rgba(255,255,255,0.34)" />
          <stop offset="0.5" stopColor="var(--surface-3)" />
          <stop offset="1" stopColor="var(--surface-inset)" />
        </linearGradient>
        <linearGradient id={emberId} x1="17" y1="52" x2="51" y2="15" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="var(--ember-700)" />
          <stop offset="0.48" stopColor="var(--accent)" />
          <stop offset="1" stopColor="var(--ember-200)" />
        </linearGradient>
        <linearGradient id={emberHotId} x1="23" y1="21" x2="49" y2="46" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="var(--ember-100)" />
          <stop offset="0.38" stopColor="var(--accent-hi)" />
          <stop offset="1" stopColor="var(--ember-500)" />
        </linearGradient>
        <linearGradient id={glassId} x1="12" y1="48" x2="50" y2="14" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="var(--glacier-400)" stopOpacity="0.8" />
          <stop offset="1" stopColor="var(--glacier-300)" stopOpacity="0.16" />
        </linearGradient>
        <radialGradient id={coreId} cx="0" cy="0" r="1" gradientUnits="userSpaceOnUse" gradientTransform="translate(32 32) rotate(90) scale(12)">
          <stop offset="0" stopColor="var(--ember-100)" />
          <stop offset="0.38" stopColor="var(--accent-hi)" />
          <stop offset="1" stopColor="var(--accent)" stopOpacity="0.1" />
        </radialGradient>
        <filter id={shadowId} x="-24%" y="-24%" width="148%" height="150%" colorInterpolationFilters="sRGB">
          <feDropShadow dx="0" dy="2" stdDeviation="2.3" floodColor="#000" floodOpacity="0.5" />
          <feDropShadow dx="0" dy="0" stdDeviation="3.4" floodColor="var(--accent)" floodOpacity="0.24" />
        </filter>
      </defs>

      <path
        d="M45.5 11.7A25.8 25.8 0 0 0 15.8 48.2"
        stroke={`url(#${rimId})`}
        strokeWidth="5.5"
        strokeLinecap="round"
        strokeDasharray="22 6 11 8"
      />
      <path
        d="M15.8 48.2A25.8 25.8 0 0 0 44.3 53.1"
        stroke={`url(#${emberId})`}
        strokeWidth="5.5"
        strokeLinecap="round"
        strokeDasharray="13 4 8"
        filter={`url(#${shadowId})`}
      />
      <path
        d="M18.2 43.7A20.3 20.3 0 0 1 46.1 17.9"
        stroke={`url(#${glassId})`}
        strokeWidth="1.35"
        strokeLinecap="round"
        strokeDasharray="9 7"
        opacity="0.86"
      />

      <g filter={`url(#${shadowId})`}>
        <path d="M31.6 10.4 47.3 19.1 34.3 29.8 18.9 24.6Z" fill={`url(#${emberHotId})`} />
        <path d="M49.6 22.7 44.5 44.6 32.8 35.2 34.3 29.8Z" fill={`url(#${emberId})`} />
        <path d="M29.1 53.4 16.4 42.1 18.9 24.6 32.8 35.2Z" fill="var(--ember-500)" opacity="0.92" />
        <path d="M18.9 24.6 34.3 29.8 32.8 35.2 16.4 42.1Z" fill="rgba(255,226,203,0.2)" />
        <path d="M34.3 29.8 47.3 19.1 49.6 22.7 32.8 35.2Z" fill="rgba(255,255,255,0.14)" />
        <path d="M32.8 35.2 44.5 44.6 29.1 53.4Z" fill="rgba(8,8,13,0.34)" />
        <circle cx="32.1" cy="32.2" r="8.5" fill={`url(#${coreId})`} opacity="0.42" />
        <circle cx="32.1" cy="32.2" r="2.8" fill="var(--ember-100)" opacity="0.92" />
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
    <span className={`cockpitWordmark ${className}`.trim()} aria-label="cockpiT">
      <span>cockpi</span>
      <span className="cockpitWordmark__accent">T</span>
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
