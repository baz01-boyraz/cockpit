import { useEffect, useState } from 'react'
import { IconChevron } from './icons'

// Terminal-style update-download panel. Ported from a 21st.dev concept the team
// liked, then re-themed to the ember system and rebuilt without framer-motion /
// lucide / Tailwind — CSS keyframes drive the chevrons + dots, and a tiny
// scramble runs in React. It is fed REAL download progress, not the demo's
// faux file/time counters.

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
const randChar = (): string => ALPHABET[Math.floor(Math.random() * ALPHABET.length)]

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return false
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches
  })

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    const onChange = () => setReduced(mq.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  return reduced
}

// Reveal `target` left→right out of A–Z noise (the HyperText effect, minus the
// framer-motion runtime). Reduced motion jumps straight to the resolved string.
function useScrambledText(target: string, reduced: boolean): string {
  const [display, setDisplay] = useState(target)

  useEffect(() => {
    if (reduced) {
      setDisplay(target)
      return
    }

    let tick = 0
    const id = window.setInterval(() => {
      tick += 1
      const revealed = Math.floor(tick / 3)
      setDisplay(
        target
          .split('')
          .map((ch, i) => (ch === ' ' ? ' ' : i < revealed ? ch : randChar()))
          .join(''),
      )
      if (revealed >= target.length) window.clearInterval(id)
    }, 38)

    return () => window.clearInterval(id)
  }, [target, reduced])

  return display
}

export type AnimatedDownloadPhase = 'downloading' | 'downloaded'

interface AnimatedDownloadProps {
  percent: number
  phase: AnimatedDownloadPhase
  version?: string | null
  className?: string
}

export function AnimatedDownload({ percent, phase, version, className }: AnimatedDownloadProps) {
  const reduced = usePrefersReducedMotion()
  const active = phase === 'downloading'
  const clamped = Math.max(0, Math.min(100, Math.round(Number.isFinite(percent) ? percent : 0)))
  const banner = active ? 'DOWNLOADING' : 'COMPLETE'
  const text = useScrambledText(banner, reduced)

  return (
    <div
      className={`adl${active ? ' adl--active' : ''}${className ? ` ${className}` : ''}`}
      role="group"
      aria-label={active ? `Downloading update, ${clamped}%` : 'Update downloaded'}
    >
      <div className="adl__head">
        <div className="adl__chevs" aria-hidden="true">
          <span className="adl__chev">
            <IconChevron width={20} height={20} />
          </span>
          <span className="adl__chev adl__chev--2">
            <IconChevron width={20} height={20} />
          </span>
        </div>

        <div className="adl__banner">
          <span className="adl__bannerText">{text}</span>
          {active ? (
            <span className="adl__dots" aria-hidden="true">
              <span>.</span>
              <span>.</span>
              <span>.</span>
            </span>
          ) : null}
        </div>
      </div>

      <div className="adl__rule" aria-hidden="true" />

      <div className="adl__labels">
        <span className="adl__label">PROGRESS</span>
        <span className="adl__label">VERSION</span>
        <span className="adl__label">DOWNLOADED</span>
      </div>

      <div className="adl__values">
        <div className="adl__bar">
          <span className="adl__barFill" style={{ width: `${clamped}%` }} />
        </div>
        <span className="adl__value">v{version ?? 'latest'}</span>
        <span className="adl__value adl__value--pct">{clamped}%</span>
      </div>

      <div className="adl__accent" aria-hidden="true" />
    </div>
  )
}
