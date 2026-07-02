import { useEffect, useRef, useState } from 'react'

const DURATION_MS = 450

/**
 * Instrument tick-up: counts from the previous value (0 on mount) to the
 * target with an ease-out curve. Pair with `tabular-nums` so nothing shifts.
 * Jumps instantly under prefers-reduced-motion.
 */
export function useCountUp(target: number): number {
  const [value, setValue] = useState(0)
  const fromRef = useRef(0)

  useEffect(() => {
    const from = fromRef.current
    fromRef.current = target
    if (from === target) {
      setValue(target)
      return
    }
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setValue(target)
      return
    }
    let raf = 0
    const start = performance.now()
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / DURATION_MS)
      const eased = 1 - Math.pow(1 - t, 3)
      setValue(Math.round(from + (target - from) * eased))
      if (t < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [target])

  return value
}

interface CountUpProps {
  value: number
}

export function CountUp({ value }: CountUpProps) {
  const shown = useCountUp(value)
  return <>{shown}</>
}
