import { useCallback, useLayoutEffect, useRef, useState } from 'react'

interface WindowedListOptions {
  /** Estimated uniform row height in px (incl. any inter-row gap). */
  rowHeight: number
  /** Rows rendered beyond the viewport on each side, to hide scroll seams. */
  overscan?: number
  /** Below this row count the list renders in full — no windowing at all. */
  threshold?: number
}

interface WindowedList {
  /** Attach to the scroll container. */
  scrollRef: React.RefObject<HTMLDivElement>
  /** Attach to the container's onScroll. */
  onScroll: () => void
  /** True only once the row count crosses the threshold. */
  windowed: boolean
  /** Half-open index range [start, end) to render when windowed. */
  start: number
  end: number
  /** Spacer heights standing in for the rows above / below the window. */
  padTop: number
  padBottom: number
}

/**
 * Minimal fixed-height list windowing — no dependency.
 *
 * Fits uniform-height rows (the log stream). Below `threshold` it is a no-op:
 * `windowed` stays false and the caller renders every row exactly as before,
 * so small lists are pixel-identical to today. Above it, only the visible
 * slice (+ overscan) is rendered and two spacer divs preserve scroll geometry.
 */
export function useWindowedList(count: number, options: WindowedListOptions): WindowedList {
  const { rowHeight, overscan = 8, threshold = 200 } = options
  const scrollRef = useRef<HTMLDivElement>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [viewport, setViewport] = useState(0)

  const windowed = count > threshold

  const measure = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    setScrollTop(el.scrollTop)
    setViewport(el.clientHeight)
  }, [])

  // Capture the viewport height once windowing turns on (and on count change,
  // since the scrollbar can appear/disappear).
  useLayoutEffect(() => {
    if (windowed) measure()
  }, [windowed, count, measure])

  if (!windowed) {
    return { scrollRef, onScroll: measure, windowed, start: 0, end: count, padTop: 0, padBottom: 0 }
  }

  const start = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan)
  const end = Math.min(count, Math.ceil((scrollTop + viewport) / rowHeight) + overscan)
  const padTop = start * rowHeight
  const padBottom = Math.max(0, (count - end) * rowHeight)

  return { scrollRef, onScroll: measure, windowed, start, end, padTop, padBottom }
}
