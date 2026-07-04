import { useEffect, useRef, useState } from 'react'
import type { MemoryHubSnapshot } from '@shared/memory-hub'
import {
  defaultForceConfig,
  seedPositions,
  simulate,
  tick,
  type ForceEdge,
  type ForceNode,
} from '@shared/forceGraph'
import { cockpit } from '../../lib/cockpit'

interface GraphNodeMeta {
  id: string
  label: string
  /** Unresolved wikilink target — a note the hub wants but doesn't have. */
  ghost: boolean
  radius: number
}

interface GraphData {
  metas: GraphNodeMeta[]
  edges: ForceEdge[]
}

interface MemoryGraphProps {
  projectId: string
  snapshot: MemoryHubSnapshot
  /** Real-node click → open that note back in the reader. */
  onOpen: (name: string) => void
}

const TICKS_PER_FRAME = 3
const MAX_SYNC_TICKS = 400
const CLICK_SLOP_PX = 5
const HALO_SPRITE = 128
const PULSE_SPRITE = 28
const MAX_PULSES = 26
const LABEL_MAX = 15

const nodeRadius = (connections: number): number => Math.min(6 + connections * 1.3, 14)

/** Deterministic 0..1 hash of a string — stable per-node phases, no Math.random. */
function hash01(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return (h >>> 0) / 4294967295
}

/** "#ee7c42" → "rgba(238, 124, 66, a)" — canvas needs explicit alpha. */
function withAlpha(hex: string, alpha: number): string {
  const h = hex.trim().replace('#', '')
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h
  const int = Number.parseInt(full.slice(0, 6), 16)
  if (!Number.isFinite(int)) return `rgba(238, 124, 66, ${alpha})`
  return `rgba(${(int >> 16) & 255}, ${(int >> 8) & 255}, ${int & 255}, ${alpha})`
}

interface Palette {
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

function readPalette(): Palette {
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

type Tier = 'amber' | 'ember' | 'glacier' | 'ghost'

/** Per-node visual identity: color, glow sprite, and idle-life phases. */
interface VMeta {
  color: string
  hot: string
  sprite: HTMLCanvasElement
  degree: number
  driftAmp: number
  driftFx: number
  driftFy: number
  driftPx: number
  driftPy: number
  breatheFx: number
  breathePhase: number
}

/** A signal firing along an edge — travels 0→1 with a fading tail. */
interface Pulse {
  edge: number
  t: number
  speed: number
  glacier: boolean
}

/** Pre-render a soft additive glow disc once; drawImage-scaled per node (cheap). */
function makeGlowSprite(color: string, hot: string): HTMLCanvasElement {
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
function makePulseSprite(color: string, hot: string): HTMLCanvasElement {
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

/** Edges from per-note outgoing links; ghosts from the unresolved aggregate. */
async function loadGraph(projectId: string, snapshot: MemoryHubSnapshot): Promise<GraphData> {
  const notes = await Promise.all(
    snapshot.notes.map((n) => cockpit().memory.read(projectId, n.name)),
  )
  const edges: ForceEdge[] = []
  for (const note of notes) {
    if (!note) continue
    for (const target of note.outgoing) edges.push({ source: note.name, target })
  }
  for (const u of snapshot.unresolved) {
    for (const wanter of u.wantedBy) edges.push({ source: wanter, target: u.target })
  }
  const metas: GraphNodeMeta[] = [
    ...snapshot.notes.map((n) => ({
      id: n.name,
      label: n.title,
      ghost: false,
      radius: nodeRadius(n.linksOut + n.backlinks),
    })),
    ...snapshot.unresolved.map((u) => ({
      id: u.target,
      label: u.target,
      ghost: true,
      radius: nodeRadius(u.wantedBy.length),
    })),
  ]
  return { metas, edges }
}

/**
 * Living neural-network view of the hub (VISION 5.5). The layout anchor is the
 * pure force simulation in shared/forceGraph; on top of the settled anchors the
 * canvas paints neurons — bright cores wrapped in soft additive halos that
 * breathe out of phase and drift gently — wired by curved synapses that fire
 * travelling pulse particles, over a slow ember/glacier nebula. Hover focuses a
 * neuron's neighbourhood (others dim, its synapses fire harder); drag pins while
 * dragging; clicking a real note hands off to the reader. Ghost (unresolved)
 * targets are dim pulsing dashed rings. Under prefers-reduced-motion the settled
 * layout is drawn once, static.
 */
export function MemoryGraph({ projectId, snapshot, onOpen }: MemoryGraphProps) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [data, setData] = useState<GraphData | null>(null)
  const [failed, setFailed] = useState(false)

  // Hubs are small — read every note exactly once per graph open.
  useEffect(() => {
    let cancelled = false
    loadGraph(projectId, snapshot)
      .then((graph) => {
        if (!cancelled) setData(graph)
      })
      .catch(() => {
        if (!cancelled) setFailed(true)
      })
    return () => {
      cancelled = true
    }
  }, [projectId, snapshot])

  useEffect(() => {
    const canvas = canvasRef.current
    const wrap = wrapRef.current
    if (!canvas || !wrap || !data) return

    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const palette = readPalette()
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const metaById = new Map(data.metas.map((m) => [m.id, m]))
    const neighbors = new Map<string, Set<string>>()
    for (const e of data.edges) {
      if (!neighbors.has(e.source)) neighbors.set(e.source, new Set())
      if (!neighbors.has(e.target)) neighbors.set(e.target, new Set())
      neighbors.get(e.source)!.add(e.target)
      neighbors.get(e.target)!.add(e.source)
    }

    // --- pre-rendered glow sprites (one per colour tier) ---
    const sprites: Record<Tier, HTMLCanvasElement> = {
      amber: makeGlowSprite(palette.ember3, palette.emberHot),
      ember: makeGlowSprite(palette.ember4, palette.ember3),
      glacier: makeGlowSprite(palette.glacier4, palette.glacier3),
      ghost: makeGlowSprite(palette.ember7, palette.ember5),
    }
    const pulseEmber = makePulseSprite(palette.ember4, palette.ember3)
    const pulseGlacier = makePulseSprite(palette.glacier4, palette.glacier3)

    const degreeOf = (id: string): number => neighbors.get(id)?.size ?? 0
    const maxDeg = Math.max(1, ...data.metas.map((m) => degreeOf(m.id)))

    // --- per-node visual identity + idle-life phases ---
    const vById = new Map<string, VMeta>()
    for (const meta of data.metas) {
      const deg = degreeOf(meta.id)
      const p = hash01(meta.id)
      const py = hash01(meta.id + '~y')
      let tier: Tier
      if (meta.ghost) tier = 'ghost'
      else if (deg >= 3 && deg >= maxDeg * 0.6) tier = 'amber'
      else if (Math.floor(p * 6) === 0) tier = 'glacier'
      else tier = 'ember'
      const color =
        tier === 'amber'
          ? palette.ember3
          : tier === 'glacier'
            ? palette.glacier4
            : tier === 'ghost'
              ? palette.ember5
              : palette.ember4
      const hot =
        tier === 'amber'
          ? palette.emberHot
          : tier === 'glacier'
            ? palette.glacier3
            : tier === 'ghost'
              ? palette.ember4
              : palette.ember3
      vById.set(meta.id, {
        color,
        hot,
        sprite: sprites[tier],
        degree: deg,
        driftAmp: 2.4 + (1 - deg / maxDeg) * 4.6,
        driftFx: 0.16 + p * 0.13,
        driftFy: 0.14 + py * 0.12,
        driftPx: p * Math.PI * 2,
        driftPy: py * Math.PI * 2,
        breatheFx: 0.55 + p * 0.55,
        breathePhase: p * Math.PI * 2,
      })
    }

    let width = wrap.clientWidth
    let height = wrap.clientHeight
    let config = defaultForceConfig(width / 2, height / 2)
    let nodes: ForceNode[] = []
    let renderPos = new Map<string, { x: number; y: number }>()
    let pulses: Pulse[] = []
    let hovered: string | null = null
    let dragged: string | null = null
    let downAt: { x: number; y: number } | null = null
    let raf = 0
    let running = false
    let settled = false
    let lastNow = 0
    let atmo: HTMLCanvasElement | null = null

    const applySize = () => {
      width = Math.max(wrap.clientWidth, 80)
      height = Math.max(wrap.clientHeight, 80)
      const dpr = window.devicePixelRatio || 1
      canvas.width = Math.round(width * dpr)
      canvas.height = Math.round(height * dpr)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      config = { ...config, cx: width / 2, cy: height / 2 }
      atmo = buildAtmosphere()
    }

    // --- geometry helpers ---
    const renderXY = (node: ForceNode, t: number): { x: number; y: number } => {
      const v = vById.get(node.id)
      if (!v || node.id === dragged || reduceMotion) return { x: node.x, y: node.y }
      const dx = Math.sin(t * v.driftFx + v.driftPx) * v.driftAmp
      const dy = Math.cos(t * v.driftFy + v.driftPy) * v.driftAmp
      return { x: node.x + dx, y: node.y + dy }
    }

    /** Quadratic control point — a slight, stable perpendicular bow per edge. */
    const controlOf = (
      i: number,
      ax: number,
      ay: number,
      bx: number,
      by: number,
    ): { x: number; y: number } => {
      const dx = bx - ax
      const dy = by - ay
      const len = Math.hypot(dx, dy) || 1
      const dir = i % 2 === 0 ? 1 : -1
      const bow = Math.min(len * 0.14, 26) * dir
      return { x: (ax + bx) / 2 + (-dy / len) * bow, y: (ay + by) / 2 + (dx / len) * bow }
    }

    const bezier = (
      ax: number,
      ay: number,
      cx: number,
      cy: number,
      bx: number,
      by: number,
      t: number,
    ): { x: number; y: number } => {
      const mt = 1 - t
      return {
        x: mt * mt * ax + 2 * mt * t * cx + t * t * bx,
        y: mt * mt * ay + 2 * mt * t * cy + t * t * by,
      }
    }

    /**
     * Pre-render the ember/glacier nebula + vignette once per size to an offscreen
     * canvas. The atmosphere is static (its old slow drift was imperceptible and
     * cost 5 radial-gradient allocations every frame); caching it is the single
     * biggest per-frame win, so the field reads calm instead of laggy.
     */
    const buildAtmosphere = (): HTMLCanvasElement => {
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

    const spawnPulses = (dt: number, litEdges: number[] | null) => {
      const cap = Math.min(MAX_PULSES, Math.round(5 + data.edges.length * 0.45))
      if (pulses.length >= cap || data.edges.length === 0) return
      const rate = (litEdges ? 9 : 3.2) * dt
      if (Math.random() > rate) return
      let edge: number
      if (litEdges && litEdges.length && Math.random() < 0.78) {
        edge = litEdges[(Math.random() * litEdges.length) | 0]
      } else {
        edge = (Math.random() * data.edges.length) | 0
      }
      pulses.push({
        edge,
        t: 0,
        speed: 0.32 + Math.random() * 0.36,
        glacier: Math.random() < 0.18,
      })
    }

    const draw = (t: number) => {
      ctx.clearRect(0, 0, width, height)
      if (atmo) ctx.drawImage(atmo, 0, 0, width, height)

      renderPos = new Map(nodes.map((n) => [n.id, renderXY(n, t)]))
      const hoodOf = hovered ? neighbors.get(hovered) : undefined
      const litEdgeSet = new Set<number>()
      if (hovered) {
        data.edges.forEach((e, i) => {
          if (e.source === hovered || e.target === hovered) litEdgeSet.add(i)
        })
      }

      // --- synapses (curved, gradient stroke, low base alpha) ---
      data.edges.forEach((edge, i) => {
        const a = renderPos.get(edge.source)
        const b = renderPos.get(edge.target)
        if (!a || !b) return
        const va = vById.get(edge.source)
        const vb = vById.get(edge.target)
        if (!va || !vb) return
        const lit = litEdgeSet.has(i)
        const dim = hovered !== null && !lit
        const c = controlOf(i, a.x, a.y, b.x, b.y)
        const toGhost = metaById.get(edge.target)?.ghost ?? false
        const alpha = lit ? 0.55 : dim ? 0.05 : 0.17
        const grad = ctx.createLinearGradient(a.x, a.y, b.x, b.y)
        grad.addColorStop(0, withAlpha(va.color, alpha))
        grad.addColorStop(1, withAlpha(vb.color, alpha * (toGhost ? 0.5 : 1)))

        ctx.save()
        if (lit) ctx.globalCompositeOperation = 'lighter'
        ctx.beginPath()
        ctx.setLineDash(toGhost ? [3, 5] : [])
        ctx.strokeStyle = grad
        ctx.lineWidth = lit ? 1.7 : 0.9
        ctx.moveTo(a.x, a.y)
        ctx.quadraticCurveTo(c.x, c.y, b.x, b.y)
        ctx.stroke()
        ctx.restore()
      })
      ctx.setLineDash([])

      // --- travelling pulses (additive, fading tail) ---
      ctx.globalCompositeOperation = 'lighter'
      for (const pulse of pulses) {
        const edge = data.edges[pulse.edge]
        const a = renderPos.get(edge.source)
        const b = renderPos.get(edge.target)
        if (!a || !b) continue
        const dim = hovered !== null && !litEdgeSet.has(pulse.edge)
        if (dim) continue
        const c = controlOf(pulse.edge, a.x, a.y, b.x, b.y)
        const sprite = pulse.glacier ? pulseGlacier : pulseEmber
        const TAIL = 7
        for (let k = 0; k < TAIL; k++) {
          const tt = pulse.t - k * 0.055
          if (tt < 0) break
          const p = bezier(a.x, a.y, c.x, c.y, b.x, b.y, tt)
          const fade = (1 - k / TAIL) * (1 - k / TAIL)
          const size = (k === 0 ? 13 : 8) * (0.55 + 0.45 * fade)
          ctx.globalAlpha = fade * (litEdgeSet.has(pulse.edge) ? 1 : 0.82)
          ctx.drawImage(sprite, p.x - size / 2, p.y - size / 2, size, size)
        }
      }
      ctx.globalAlpha = 1

      // --- neuron halos (additive, breathing) ---
      for (const node of nodes) {
        const meta = metaById.get(node.id)
        const v = vById.get(node.id)
        const p = renderPos.get(node.id)
        if (!meta || !v || !p) continue
        const isHover = node.id === hovered
        const near = hoodOf?.has(node.id) ?? false
        const dim = hovered !== null && !isHover && !near
        const breathe = 0.5 + 0.5 * Math.sin(t * v.breatheFx + v.breathePhase)
        const focus = isHover ? 1.55 : near ? 1.08 : dim ? 0.32 : 1
        const haloScale = meta.radius * (meta.ghost ? 3.0 : 3.6) * (0.86 + breathe * 0.28) * focus
        const haloAlpha = (meta.ghost ? 0.5 : 0.9) * (0.62 + breathe * 0.38) * focus
        ctx.globalAlpha = Math.min(1, haloAlpha)
        ctx.drawImage(v.sprite, p.x - haloScale, p.y - haloScale, haloScale * 2, haloScale * 2)
      }
      ctx.globalAlpha = 1
      ctx.globalCompositeOperation = 'source-over'

      // --- neuron cores + ghost rings ---
      for (const node of nodes) {
        const meta = metaById.get(node.id)
        const v = vById.get(node.id)
        const p = renderPos.get(node.id)
        if (!meta || !v || !p) continue
        const isHover = node.id === hovered
        const near = hoodOf?.has(node.id) ?? false
        const dim = hovered !== null && !isHover && !near
        const breathe = 0.5 + 0.5 * Math.sin(t * v.breatheFx + v.breathePhase)

        if (meta.ghost) {
          ctx.beginPath()
          ctx.setLineDash([3.5, 3])
          ctx.lineDashOffset = -t * 6
          ctx.arc(p.x, p.y, meta.radius, 0, Math.PI * 2)
          ctx.strokeStyle = withAlpha(
            isHover ? palette.ember3 : palette.faint,
            (dim ? 0.34 : 0.7) * (0.6 + breathe * 0.4),
          )
          ctx.lineWidth = 1.4
          ctx.stroke()
          ctx.setLineDash([])
          ctx.lineDashOffset = 0
          continue
        }

        const coreR = meta.radius * (isHover ? 0.72 : 0.58)
        ctx.beginPath()
        ctx.arc(p.x, p.y, coreR, 0, Math.PI * 2)
        ctx.fillStyle = withAlpha(v.color, dim ? 0.4 : 1)
        ctx.fill()
        // hot inner pip
        ctx.beginPath()
        ctx.arc(p.x, p.y, coreR * 0.42, 0, Math.PI * 2)
        ctx.fillStyle = withAlpha(v.hot, dim ? 0.5 : 0.95)
        ctx.fill()
      }

      // --- labels (precise mono caps) ---
      ctx.textAlign = 'center'
      ctx.textBaseline = 'top'
      ctx.letterSpacing = '0.09em'
      for (const node of nodes) {
        const meta = metaById.get(node.id)
        const p = renderPos.get(node.id)
        if (!meta || !p) continue
        const isHover = node.id === hovered
        const near = hoodOf?.has(node.id) ?? false
        const dim = hovered !== null && !isHover && !near
        const raw = meta.label.toUpperCase()
        const text = raw.length > LABEL_MAX ? raw.slice(0, LABEL_MAX - 1) + '…' : raw
        ctx.font = `${isHover ? 600 : 500} 9.5px ${palette.mono}`
        ctx.fillStyle = meta.ghost
          ? withAlpha(palette.faint, dim ? 0.35 : 0.85)
          : isHover
            ? palette.text
            : withAlpha(palette.muted, dim ? 0.28 : 0.82)
        ctx.fillText(text, p.x, p.y + meta.radius + 6)
        if (isHover && (vById.get(node.id)?.degree ?? 0) > 0) {
          ctx.font = `500 8px ${palette.mono}`
          ctx.fillStyle = withAlpha(palette.ember3, 0.7)
          ctx.fillText(`${vById.get(node.id)!.degree} LINKS`, p.x, p.y + meta.radius + 18)
        }
      }
      ctx.letterSpacing = '0px'
    }

    const frame = (now: number) => {
      const t = now / 1000
      const dt = lastNow ? Math.min((now - lastNow) / 1000, 0.05) : 0.016
      lastNow = now

      if (!settled || dragged !== null) {
        let speed = 0
        for (let i = 0; i < TICKS_PER_FRAME; i++) {
          const result = tick(nodes, data.edges, config)
          nodes = result.nodes
          speed = result.speed
        }
        if (speed < config.settleSpeed && dragged === null) settled = true
      }

      const litEdges = hovered
        ? data.edges.reduce<number[]>((acc, e, i) => {
            if (e.source === hovered || e.target === hovered) acc.push(i)
            return acc
          }, [])
        : null
      // Only breed new signals while the field is alive (settling, hovered, or
      // dragged). Once calm and untouched, existing pulses drain and the loop
      // sleeps — a settled, idle graph must not burn a frame budget forever.
      if (!settled || hovered !== null || dragged !== null) spawnPulses(dt, litEdges)
      pulses = pulses
        .map((pulse) => ({ ...pulse, t: pulse.t + pulse.speed * dt }))
        .filter((pulse) => pulse.t <= 1.05)

      draw(t)

      const alive = !settled || dragged !== null || hovered !== null || pulses.length > 0
      if (alive) {
        raf = requestAnimationFrame(frame)
      } else {
        running = false
      }
    }

    const wake = () => {
      if (running || reduceMotion) return
      running = true
      raf = requestAnimationFrame(frame)
    }

    const settleNow = () => {
      nodes = simulate(nodes, data.edges, config, MAX_SYNC_TICKS).nodes
      renderPos = new Map(nodes.map((n) => [n.id, { x: n.x, y: n.y }]))
      draw(0)
    }

    const start = () => {
      applySize()
      nodes = seedPositions(
        data.metas.map((m) => m.id),
        config.cx,
        config.cy,
      )
      renderPos = new Map(nodes.map((n) => [n.id, { x: n.x, y: n.y }]))
      if (reduceMotion) settleNow()
      else wake()
    }

    const hitTest = (x: number, y: number): string | null => {
      for (let i = nodes.length - 1; i >= 0; i--) {
        const meta = metaById.get(nodes[i].id)
        const p = renderPos.get(nodes[i].id) ?? nodes[i]
        const r = (meta?.radius ?? 6) + 5
        const dx = p.x - x
        const dy = p.y - y
        if (dx * dx + dy * dy <= r * r) return nodes[i].id
      }
      return null
    }

    const toLocal = (e: PointerEvent): { x: number; y: number } => {
      const rect = canvas.getBoundingClientRect()
      return { x: e.clientX - rect.left, y: e.clientY - rect.top }
    }

    const onPointerMove = (e: PointerEvent) => {
      const p = toLocal(e)
      if (dragged) {
        nodes = nodes.map((n) => (n.id === dragged ? { ...n, x: p.x, y: p.y } : n))
        settled = false
        if (reduceMotion) draw(0)
        else wake()
        return
      }
      const hit = hitTest(p.x, p.y)
      if (hit !== hovered) {
        hovered = hit
        canvas.style.cursor = hit ? 'pointer' : 'default'
        // hovering a calm, sleeping field brings it back to life
        if (reduceMotion) draw(0)
        else wake()
      }
    }

    const onPointerDown = (e: PointerEvent) => {
      const p = toLocal(e)
      const hit = hitTest(p.x, p.y)
      if (!hit) return
      dragged = hit
      downAt = p
      settled = false
      nodes = nodes.map((n) => (n.id === hit ? { ...n, pinned: true, x: p.x, y: p.y } : n))
      canvas.setPointerCapture(e.pointerId)
      if (reduceMotion) draw(0)
      else wake()
    }

    const onPointerUp = (e: PointerEvent) => {
      if (!dragged) return
      const p = toLocal(e)
      const id = dragged
      dragged = null
      nodes = nodes.map((n) => (n.id === id ? { ...n, pinned: false } : n))
      canvas.releasePointerCapture(e.pointerId)
      const moved = downAt ? Math.hypot(p.x - downAt.x, p.y - downAt.y) : 0
      downAt = null
      if (moved <= CLICK_SLOP_PX && !metaById.get(id)?.ghost) {
        onOpen(id)
        return
      }
      settled = false
      if (reduceMotion) settleNow()
      else wake()
    }

    const onLeave = () => {
      if (hovered && !dragged) {
        hovered = null
        canvas.style.cursor = 'default'
        // wake once to repaint the un-focused state, then it settles to sleep
        if (reduceMotion) draw(0)
        else wake()
      }
    }

    const resizer = new ResizeObserver(() => {
      applySize()
      settled = false
      if (reduceMotion) settleNow()
      else wake()
    })

    canvas.addEventListener('pointermove', onPointerMove)
    canvas.addEventListener('pointerdown', onPointerDown)
    canvas.addEventListener('pointerup', onPointerUp)
    canvas.addEventListener('pointerleave', onLeave)
    start()
    resizer.observe(wrap)

    return () => {
      cancelAnimationFrame(raf)
      running = false
      resizer.disconnect()
      canvas.removeEventListener('pointermove', onPointerMove)
      canvas.removeEventListener('pointerdown', onPointerDown)
      canvas.removeEventListener('pointerup', onPointerUp)
      canvas.removeEventListener('pointerleave', onLeave)
    }
  }, [data, onOpen])

  return (
    <section className="card memgraph" aria-label="Memory graph">
      <div ref={wrapRef} className="memgraph__stage">
        {failed ? (
          <div className="memgraph__status">Couldn&rsquo;t read the hub for the graph.</div>
        ) : !data ? (
          <div className="memgraph__status">
            <span className="memory__pulse" aria-hidden />
            Mapping connections…
          </div>
        ) : (
          <canvas ref={canvasRef} className="memgraph__canvas" />
        )}
      </div>
      {data && !failed && (
        <div className="memgraph__hint mono">
          {data.metas.length} neurons · drag to pin · click a note to open · dashed = unresolved
        </div>
      )}
    </section>
  )
}
