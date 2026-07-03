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

const nodeRadius = (connections: number): number => Math.min(6 + connections * 1.3, 14)

/** "#ee7c42" → "rgba(238, 124, 66, a)" — canvas needs explicit alpha. */
function withAlpha(hex: string, alpha: number): string {
  const h = hex.trim().replace('#', '')
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h
  const int = Number.parseInt(full.slice(0, 6), 16)
  if (!Number.isFinite(int)) return `rgba(238, 124, 66, ${alpha})`
  return `rgba(${(int >> 16) & 255}, ${(int >> 8) & 255}, ${int & 255}, ${alpha})`
}

function readPalette(): Record<'ember3' | 'ember4' | 'ember5' | 'text' | 'muted' | 'faint', string> {
  const styles = getComputedStyle(document.documentElement)
  const token = (name: string, fallback: string): string =>
    styles.getPropertyValue(name).trim() || fallback
  return {
    ember3: token('--ember-300', '#ff9d63'),
    ember4: token('--ember-400', '#ee7c42'),
    ember5: token('--ember-500', '#d3642f'),
    text: token('--text', '#e8eaf0'),
    muted: token('--text-muted', '#a2a8b4'),
    faint: token('--text-faint', '#61656f'),
  }
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
 * Force-directed canvas view of the hub (VISION 5.5). Ember dots sized by
 * connectedness, copper edges, dashed ghosts for unresolved targets. Hover
 * highlights a node's neighborhood; drag pins while dragging; clicking a real
 * note hands off to the reader. Physics lives in shared/forceGraph (pure);
 * under prefers-reduced-motion the settled layout is drawn in one frame.
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

    let width = wrap.clientWidth
    let height = wrap.clientHeight
    let config = defaultForceConfig(width / 2, height / 2)
    let nodes: ForceNode[] = []
    let hovered: string | null = null
    let dragged: string | null = null
    let downAt: { x: number; y: number } | null = null
    let raf = 0
    let running = false

    const applySize = () => {
      width = Math.max(wrap.clientWidth, 80)
      height = Math.max(wrap.clientHeight, 80)
      const dpr = window.devicePixelRatio || 1
      canvas.width = Math.round(width * dpr)
      canvas.height = Math.round(height * dpr)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      config = { ...config, cx: width / 2, cy: height / 2 }
    }

    const draw = () => {
      ctx.clearRect(0, 0, width, height)
      const byId = new Map(nodes.map((n) => [n.id, n]))
      const hoodOf = hovered ? neighbors.get(hovered) : undefined

      for (const edge of data.edges) {
        const a = byId.get(edge.source)
        const b = byId.get(edge.target)
        if (!a || !b) continue
        const lit = hovered !== null && (edge.source === hovered || edge.target === hovered)
        const toGhost = metaById.get(edge.target)?.ghost ?? false
        ctx.beginPath()
        ctx.setLineDash(toGhost ? [3, 5] : [])
        ctx.strokeStyle = lit
          ? withAlpha(palette.ember3, 0.66)
          : withAlpha(palette.ember5, hovered ? 0.14 : 0.28)
        ctx.lineWidth = lit ? 1.5 : 1
        ctx.moveTo(a.x, a.y)
        ctx.lineTo(b.x, b.y)
        ctx.stroke()
      }
      ctx.setLineDash([])

      for (const node of nodes) {
        const meta = metaById.get(node.id)
        if (!meta) continue
        const isHover = node.id === hovered
        const nearHover = hoodOf?.has(node.id) ?? false
        const dim = hovered !== null && !isHover && !nearHover

        ctx.beginPath()
        ctx.arc(node.x, node.y, meta.radius, 0, Math.PI * 2)
        if (meta.ghost) {
          ctx.setLineDash([3.5, 3])
          ctx.strokeStyle = withAlpha(isHover ? palette.ember3 : palette.faint, dim ? 0.4 : 1)
          ctx.lineWidth = 1.4
          ctx.stroke()
          ctx.setLineDash([])
        } else {
          if (isHover) {
            ctx.save()
            ctx.shadowColor = withAlpha(palette.ember4, 0.55)
            ctx.shadowBlur = 14
          }
          ctx.fillStyle = isHover
            ? palette.ember3
            : withAlpha(palette.ember4, dim ? 0.38 : 0.92)
          ctx.fill()
          if (isHover) ctx.restore()
        }

        ctx.font = `500 11px ${getComputedStyle(canvas).fontFamily}`
        ctx.textAlign = 'center'
        ctx.textBaseline = 'top'
        ctx.fillStyle = meta.ghost
          ? withAlpha(palette.faint, dim ? 0.45 : 1)
          : isHover
            ? palette.text
            : withAlpha(palette.muted, dim ? 0.4 : 1)
        ctx.fillText(meta.label, node.x, node.y + meta.radius + 5)
      }
    }

    const frame = () => {
      let speed = 0
      for (let i = 0; i < TICKS_PER_FRAME; i++) {
        const result = tick(nodes, data.edges, config)
        nodes = result.nodes
        speed = result.speed
      }
      draw()
      if (speed >= config.settleSpeed || dragged !== null) {
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
      draw()
    }

    const start = () => {
      applySize()
      nodes = seedPositions(
        data.metas.map((m) => m.id),
        config.cx,
        config.cy,
      )
      if (reduceMotion) settleNow()
      else wake()
    }

    const hitTest = (x: number, y: number): string | null => {
      for (let i = nodes.length - 1; i >= 0; i--) {
        const meta = metaById.get(nodes[i].id)
        const r = (meta?.radius ?? 6) + 4
        const dx = nodes[i].x - x
        const dy = nodes[i].y - y
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
        if (reduceMotion) draw()
        else wake()
        return
      }
      const hit = hitTest(p.x, p.y)
      if (hit !== hovered) {
        hovered = hit
        canvas.style.cursor = hit ? 'pointer' : 'default'
        if (!running) draw()
      }
    }

    const onPointerDown = (e: PointerEvent) => {
      const p = toLocal(e)
      const hit = hitTest(p.x, p.y)
      if (!hit) return
      dragged = hit
      downAt = p
      nodes = nodes.map((n) => (n.id === hit ? { ...n, pinned: true, x: p.x, y: p.y } : n))
      canvas.setPointerCapture(e.pointerId)
      if (reduceMotion) draw()
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
      if (reduceMotion) settleNow()
      else wake()
    }

    const onLeave = () => {
      if (hovered && !dragged) {
        hovered = null
        canvas.style.cursor = 'default'
        if (!running) draw()
      }
    }

    const resizer = new ResizeObserver(() => {
      applySize()
      if (reduceMotion) settleNow()
      else {
        draw()
        wake()
      }
    })

    canvas.addEventListener('pointermove', onPointerMove)
    canvas.addEventListener('pointerdown', onPointerDown)
    canvas.addEventListener('pointerup', onPointerUp)
    canvas.addEventListener('pointerleave', onLeave)
    start()
    resizer.observe(wrap)

    return () => {
      cancelAnimationFrame(raf)
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
          {data.metas.length} nodes · drag to pin · click a note to open · dashed = unresolved
        </div>
      )}
    </section>
  )
}
