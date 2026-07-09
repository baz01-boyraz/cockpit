import { HALO_SPRITE, PULSE_SPRITE } from './memoryGraphModel'

/**
 * The canvas painting layer — stateless primitives for the memory graph. Colour
 * math, the palette read from CSS tokens, the pre-rendered glow/pulse sprites,
 * the static nebula, and the curve geometry. Nothing here holds engine state;
 * the orchestrator composes these each frame.
 */

/** Deterministic 0..1 hash of a string — stable per-node phases, no Math.random. */
export function hash01(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return (h >>> 0) / 4294967295
}

/** "#ee7c42" → "rgba(238, 124, 66, a)" — canvas needs explicit alpha. */
export function withAlpha(hex: string, alpha: number): string {
  const h = hex.trim().replace('#', '')
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h
  const int = Number.parseInt(full.slice(0, 6), 16)
  if (!Number.isFinite(int)) return `rgba(238, 124, 66, ${alpha})`
  return `rgba(${(int >> 16) & 255}, ${(int >> 8) & 255}, ${int & 255}, ${alpha})`
}

export interface Palette {
  emberHot: string
  ember3: string
  ember4: string
  ember5: string
  ember7: string
  glacier3: string
  glacier4: string
  text: string
  muted: string
  faint: string
  mono: string
}

export function readPalette(): Palette {
  const styles = getComputedStyle(document.documentElement)
  const token = (name: string, fallback: string): string =>
    styles.getPropertyValue(name).trim() || fallback
  return {
    emberHot: token('--ember-100', '#ffe2cb'),
    ember3: token('--ember-300', '#ffb254'),
    ember4: token('--ember-400', '#e0703a'),
    ember5: token('--ember-500', '#c25a2c'),
    ember7: token('--ember-700', '#6b2f14'),
    glacier3: token('--glacier-300', '#a9dcf1'),
    glacier4: token('--glacier-400', '#62bedd'),
    text: token('--text', '#f2f4f8'),
    muted: token('--text-muted', '#a2a8b4'),
    faint: token('--text-faint', '#61656f'),
    mono: token('--font-mono', 'ui-monospace, monospace'),
  }
}

/** Pre-render a soft additive glow disc once; drawImage-scaled per node (cheap). */
export function makeGlowSprite(color: string, hot: string): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = HALO_SPRITE
  c.height = HALO_SPRITE
  const g = c.getContext('2d')!
  const r = HALO_SPRITE / 2
  const grad = g.createRadialGradient(r, r, 0, r, r, r)
  grad.addColorStop(0, withAlpha(hot, 0.95))
  grad.addColorStop(0.12, withAlpha(color, 0.6))
  grad.addColorStop(0.32, withAlpha(color, 0.24))
  grad.addColorStop(0.6, withAlpha(color, 0.07))
  grad.addColorStop(1, withAlpha(color, 0))
  g.fillStyle = grad
  g.fillRect(0, 0, HALO_SPRITE, HALO_SPRITE)
  return c
}

/** Small hot dot sprite for travelling pulses (additive). */
export function makePulseSprite(color: string, hot: string): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = PULSE_SPRITE
  c.height = PULSE_SPRITE
  const g = c.getContext('2d')!
  const r = PULSE_SPRITE / 2
  const grad = g.createRadialGradient(r, r, 0, r, r, r)
  grad.addColorStop(0, withAlpha('#ffffff', 0.95))
  grad.addColorStop(0.25, withAlpha(hot, 0.85))
  grad.addColorStop(0.6, withAlpha(color, 0.3))
  grad.addColorStop(1, withAlpha(color, 0))
  g.fillStyle = grad
  g.fillRect(0, 0, PULSE_SPRITE, PULSE_SPRITE)
  return c
}

/**
 * Pre-render the ember/glacier nebula + vignette once per size to an offscreen
 * canvas. The atmosphere is static (its old slow drift was imperceptible and
 * cost 5 radial-gradient allocations every frame); caching it is the single
 * biggest per-frame win, so the field reads calm instead of laggy.
 */
export function buildAtmosphere(width: number, height: number, palette: Palette): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = Math.max(1, Math.round(width))
  c.height = Math.max(1, Math.round(height))
  const g = c.getContext('2d')!
  const maxWH = Math.max(width, height)
  const blobs = [
    { x: width * 0.3, y: height * 0.34, r: maxWH * 0.7, color: withAlpha(palette.ember5, 0.045) },
    { x: width * 0.72, y: height * 0.66, r: maxWH * 0.62, color: withAlpha(palette.glacier4, 0.05) },
    { x: width * 0.83, y: height * 0.31, r: maxWH * 0.5, color: withAlpha(palette.ember4, 0.04) },
  ]
  for (const b of blobs) {
    const grad = g.createRadialGradient(b.x, b.y, 0, b.x, b.y, b.r)
    grad.addColorStop(0, b.color)
    grad.addColorStop(1, withAlpha(palette.ember7, 0))
    g.fillStyle = grad
    g.fillRect(0, 0, width, height)
  }
  // central pooled light — the instrument reads as lit from within
  const core = g.createRadialGradient(width / 2, height * 0.46, 0, width / 2, height * 0.46, Math.min(width, height) * 0.5)
  core.addColorStop(0, withAlpha(palette.ember4, 0.07))
  core.addColorStop(0.5, withAlpha(palette.ember5, 0.025))
  core.addColorStop(1, withAlpha(palette.ember7, 0))
  g.fillStyle = core
  g.fillRect(0, 0, width, height)
  // vignette — corners recede so the centre reads as lit
  const vg = g.createRadialGradient(width / 2, height * 0.46, Math.min(width, height) * 0.28, width / 2, height * 0.5, Math.max(width, height) * 0.72)
  vg.addColorStop(0, 'rgba(6, 7, 11, 0)')
  vg.addColorStop(1, 'rgba(4, 5, 9, 0.55)')
  g.fillStyle = vg
  g.fillRect(0, 0, width, height)
  return c
}

/** Quadratic control point — a slight, stable perpendicular bow per edge. */
export function controlOf(
  i: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): { x: number; y: number } {
  const dx = bx - ax
  const dy = by - ay
  const len = Math.hypot(dx, dy) || 1
  const dir = i % 2 === 0 ? 1 : -1
  const bow = Math.min(len * 0.14, 26) * dir
  return { x: (ax + bx) / 2 + (-dy / len) * bow, y: (ay + by) / 2 + (dx / len) * bow }
}

export function bezier(
  ax: number,
  ay: number,
  cx: number,
  cy: number,
  bx: number,
  by: number,
  t: number,
): { x: number; y: number } {
  const mt = 1 - t
  return {
    x: mt * mt * ax + 2 * mt * t * cx + t * t * bx,
    y: mt * mt * ay + 2 * mt * t * cy + t * t * by,
  }
}
