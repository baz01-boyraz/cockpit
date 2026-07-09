import { useEffect, useRef, useState } from 'react'
import {
  defaultForceConfig,
  seedPositions,
  simulate,
  tick,
  type ForceNode,
} from '@shared/forceGraph'
import { IconFocus } from '../icons'
import {
  CLICK_SLOP_PX,
  MAX_PULSES,
  MAX_SCALE,
  MAX_SYNC_TICKS,
  MIN_SCALE,
  LABEL_MAX,
  TICKS_PER_FRAME,
  type GraphControls,
  type GraphData,
  type MemoryGraphProps,
  type Pulse,
} from './memoryGraphModel'
import {
  bezier,
  buildAtmosphere,
  controlOf,
  readPalette,
  withAlpha,
} from './memoryGraphPaint'
import {
  buildNeighbors,
  buildTierSprites,
  buildVMeta,
  loadGraph,
} from './memoryGraphData'

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
 *
 * The heavy lifting lives in siblings: `memoryGraphData` (snapshot → metas,
 * edges, per-node visual identity), `memoryGraphPaint` (stateless canvas
 * primitives), `memoryGraphModel` (types + tuning). This file is the engine:
 * camera, the rAF draw loop, and pointer interaction.
 */
export function MemoryGraph({ projectId, snapshot, onOpen }: MemoryGraphProps) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const controls = useRef<GraphControls | null>(null)
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
    const neighbors = buildNeighbors(data.edges)

    // --- pre-rendered glow sprites (one per colour tier) + per-node identity ---
    const { sprites, pulseEmber, pulseGlacier } = buildTierSprites(palette)
    const vById = buildVMeta(data.metas, neighbors, sprites, palette)

    let width = wrap.clientWidth
    let height = wrap.clientHeight
    let config = defaultForceConfig(width / 2, height / 2)
    let nodes: ForceNode[] = []
    // Reused across frames — mutated in place so the rAF loop never reallocates
    // the position Map (or its point objects); see syncRenderPos.
    const renderPos = new Map<string, { x: number; y: number }>()
    let pulses: Pulse[] = []
    let hovered: string | null = null
    let dragged: string | null = null
    let downAt: { x: number; y: number } | null = null
    let raf = 0
    let running = false
    let settled = false
    let lastNow = 0
    let atmo: HTMLCanvasElement | null = null

    // --- hover focus cache: the lit-edge sets only change when `hovered` does,
    // so they are recomputed on hover transitions — never per frame. ---
    let litEdges: number[] | null = null
    let litEdgeSet = new Set<number>()
    let hoodOf: Set<string> | undefined
    const recomputeLit = () => {
      if (hovered === null) {
        litEdges = null
        litEdgeSet = new Set()
        hoodOf = undefined
        return
      }
      const arr: number[] = []
      const set = new Set<number>()
      data.edges.forEach((e, i) => {
        if (e.source === hovered || e.target === hovered) {
          arr.push(i)
          set.add(i)
        }
      })
      litEdges = arr
      litEdgeSet = set
      hoodOf = neighbors.get(hovered)
    }

    // --- camera: world→screen is `screen = world * camScale + cam{X,Y}` ---
    let camScale = 1
    let camX = 0
    let camY = 0
    let didFit = false
    let userAdjusted = false // once true, resize keeps the user's framing
    // panning the empty field (distinct from dragging a node)
    let panning = false
    let panStart = { x: 0, y: 0 }
    let camStart = { x: 0, y: 0 }

    const applySize = () => {
      width = Math.max(wrap.clientWidth, 80)
      height = Math.max(wrap.clientHeight, 80)
      const dpr = window.devicePixelRatio || 1
      canvas.width = Math.round(width * dpr)
      canvas.height = Math.round(height * dpr)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      config = { ...config, cx: width / 2, cy: height / 2 }
      atmo = buildAtmosphere(width, height, palette)
    }

    // --- camera helpers ---
    /** Frame the whole network with breathing room — the composed "resting" shot. */
    const fitView = () => {
      if (nodes.length === 0) return
      let minX = Infinity
      let minY = Infinity
      let maxX = -Infinity
      let maxY = -Infinity
      for (const n of nodes) {
        const r = (metaById.get(n.id)?.radius ?? 6) + 24 // headroom for labels
        minX = Math.min(minX, n.x - r)
        maxX = Math.max(maxX, n.x + r)
        minY = Math.min(minY, n.y - r)
        maxY = Math.max(maxY, n.y + r)
      }
      const bw = Math.max(maxX - minX, 1)
      const bh = Math.max(maxY - minY, 1)
      const s = Math.min(width / bw, height / bh) * 0.92
      camScale = Math.max(MIN_SCALE, Math.min(s, 1.5))
      camX = width / 2 - ((minX + maxX) / 2) * camScale
      camY = height / 2 - ((minY + maxY) / 2) * camScale
    }

    /** Zoom toward a screen anchor (cursor or centre), keeping that point fixed. */
    const zoomAt = (sx: number, sy: number, factor: number) => {
      const next = Math.max(MIN_SCALE, Math.min(camScale * factor, MAX_SCALE))
      if (next === camScale) return
      const wx = (sx - camX) / camScale
      const wy = (sy - camY) / camScale
      camScale = next
      camX = sx - wx * camScale
      camY = sy - wy * camScale
      userAdjusted = true
    }

    /** Repaint now: wake the animated loop, or draw a single frame under reduced motion. */
    const repaint = () => {
      if (reduceMotion) draw(lastNow / 1000)
      else wake()
    }

    // --- geometry helpers ---
    const renderXY = (node: ForceNode, t: number): { x: number; y: number } => {
      const v = vById.get(node.id)
      if (!v || node.id === dragged || reduceMotion) return { x: node.x, y: node.y }
      const dx = Math.sin(t * v.driftFx + v.driftPx) * v.driftAmp
      const dy = Math.cos(t * v.driftFy + v.driftPy) * v.driftAmp
      return { x: node.x + dx, y: node.y + dy }
    }

    /**
     * Refresh the shared renderPos map in place — reusing point objects for live
     * nodes, adding for new ids, dropping stale ones — so an animating frame never
     * allocates a fresh Map or tuple array.
     */
    const syncRenderPos = (point: (n: ForceNode) => { x: number; y: number }) => {
      const live = new Set<string>()
      for (const n of nodes) {
        live.add(n.id)
        const np = point(n)
        const cur = renderPos.get(n.id)
        if (cur) {
          cur.x = np.x
          cur.y = np.y
        } else {
          renderPos.set(n.id, { x: np.x, y: np.y })
        }
      }
      if (renderPos.size !== live.size) {
        for (const id of renderPos.keys()) if (!live.has(id)) renderPos.delete(id)
      }
    }

    const draw = (t: number) => {
      ctx.clearRect(0, 0, width, height)
      if (atmo) ctx.drawImage(atmo, 0, 0, width, height)

      // Everything below is drawn in world space; the camera maps it to screen.
      ctx.save()
      ctx.translate(camX, camY)
      ctx.scale(camScale, camScale)

      syncRenderPos((n) => renderXY(n, t))

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
      ctx.restore()
    }

    const spawnPulses = (dt: number, lit: number[] | null) => {
      const cap = Math.min(MAX_PULSES, Math.round(5 + data.edges.length * 0.45))
      if (pulses.length >= cap || data.edges.length === 0) return
      const rate = (lit ? 9 : 3.2) * dt
      if (Math.random() > rate) return
      let edge: number
      if (lit && lit.length && Math.random() < 0.78) {
        edge = lit[(Math.random() * lit.length) | 0]
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
        if (speed < config.settleSpeed && dragged === null) {
          settled = true
          if (!didFit) {
            didFit = true
            if (!userAdjusted) fitView() // frame the settled network once
          }
        }
      }

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
      if (!didFit) {
        didFit = true
        if (!userAdjusted) fitView()
      }
      syncRenderPos((n) => ({ x: n.x, y: n.y }))
      draw(0)
    }

    const start = () => {
      applySize()
      nodes = seedPositions(
        data.metas.map((m) => m.id),
        config.cx,
        config.cy,
      )
      syncRenderPos((n) => ({ x: n.x, y: n.y }))
      if (reduceMotion) settleNow()
      else wake()
    }

    const hitTest = (x: number, y: number): string | null => {
      // pointer is in screen space; nodes live in world space.
      const wx = (x - camX) / camScale
      const wy = (y - camY) / camScale
      for (let i = nodes.length - 1; i >= 0; i--) {
        const meta = metaById.get(nodes[i].id)
        const p = renderPos.get(nodes[i].id) ?? nodes[i]
        const r = (meta?.radius ?? 6) + 6 / camScale
        const dx = p.x - wx
        const dy = p.y - wy
        if (dx * dx + dy * dy <= r * r) return nodes[i].id
      }
      return null
    }

    /** Screen point → world coords (for dragging a node under the cursor). */
    const toWorld = (x: number, y: number): { x: number; y: number } => ({
      x: (x - camX) / camScale,
      y: (y - camY) / camScale,
    })

    const toLocal = (e: { clientX: number; clientY: number }): { x: number; y: number } => {
      const rect = canvas.getBoundingClientRect()
      return { x: e.clientX - rect.left, y: e.clientY - rect.top }
    }

    const onPointerMove = (e: PointerEvent) => {
      const p = toLocal(e)
      if (dragged) {
        const w = toWorld(p.x, p.y)
        nodes = nodes.map((n) => (n.id === dragged ? { ...n, x: w.x, y: w.y } : n))
        settled = false
        if (reduceMotion) draw(0)
        else wake()
        return
      }
      if (panning) {
        camX = camStart.x + (p.x - panStart.x)
        camY = camStart.y + (p.y - panStart.y)
        userAdjusted = true
        repaint()
        return
      }
      const hit = hitTest(p.x, p.y)
      if (hit !== hovered) {
        hovered = hit
        recomputeLit()
        canvas.style.cursor = hit ? 'pointer' : 'grab'
        // hovering a calm, sleeping field brings it back to life
        if (reduceMotion) draw(0)
        else wake()
      }
    }

    const onPointerDown = (e: PointerEvent) => {
      const p = toLocal(e)
      const hit = hitTest(p.x, p.y)
      if (!hit) {
        // empty space → pan the field
        panning = true
        panStart = p
        camStart = { x: camX, y: camY }
        canvas.setPointerCapture(e.pointerId)
        canvas.style.cursor = 'grabbing'
        return
      }
      dragged = hit
      downAt = p
      settled = false
      const w = toWorld(p.x, p.y)
      nodes = nodes.map((n) => (n.id === hit ? { ...n, pinned: true, x: w.x, y: w.y } : n))
      canvas.setPointerCapture(e.pointerId)
      if (reduceMotion) draw(0)
      else wake()
    }

    const onPointerUp = (e: PointerEvent) => {
      if (panning) {
        panning = false
        canvas.releasePointerCapture(e.pointerId)
        canvas.style.cursor = 'grab'
        return
      }
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
        recomputeLit()
        canvas.style.cursor = 'default'
        // wake once to repaint the un-focused state, then it settles to sleep
        if (reduceMotion) draw(0)
        else wake()
      }
    }

    // Wheel/trackpad → zoom toward the cursor. preventDefault stops the panel
    // scrolling under the graph while you focus an area.
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const p = toLocal(e)
      const factor = Math.exp(-e.deltaY * 0.0015)
      zoomAt(p.x, p.y, factor)
      repaint()
    }

    const resizer = new ResizeObserver(() => {
      applySize()
      if (!userAdjusted) didFit = false // re-frame to the new size
      settled = false
      if (reduceMotion) settleNow()
      else wake()
    })

    // Overlay buttons drive the same camera the pointer does.
    controls.current = {
      zoomIn: () => {
        zoomAt(width / 2, height / 2, 1.3)
        repaint()
      },
      zoomOut: () => {
        zoomAt(width / 2, height / 2, 1 / 1.3)
        repaint()
      },
      reset: () => {
        userAdjusted = false
        fitView()
        repaint()
      },
    }

    canvas.addEventListener('pointermove', onPointerMove)
    canvas.addEventListener('pointerdown', onPointerDown)
    canvas.addEventListener('pointerup', onPointerUp)
    canvas.addEventListener('pointerleave', onLeave)
    canvas.addEventListener('wheel', onWheel, { passive: false })
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
      canvas.removeEventListener('wheel', onWheel)
      controls.current = null
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
          <>
            <canvas ref={canvasRef} className="memgraph__canvas" />
            <div className="memgraph__zoom" role="group" aria-label="Zoom the memory graph">
              <button
                type="button"
                className="memgraph__zoombtn"
                onClick={() => controls.current?.zoomIn()}
                aria-label="Zoom in"
                title="Zoom in"
              >
                <span aria-hidden>+</span>
              </button>
              <button
                type="button"
                className="memgraph__zoombtn"
                onClick={() => controls.current?.zoomOut()}
                aria-label="Zoom out"
                title="Zoom out"
              >
                <span aria-hidden>−</span>
              </button>
              <button
                type="button"
                className="memgraph__zoombtn memgraph__zoombtn--fit"
                onClick={() => controls.current?.reset()}
                aria-label="Fit to view"
                title="Fit the whole map"
              >
                <IconFocus width={14} height={14} />
              </button>
            </div>
          </>
        )}
      </div>
      {data && !failed && (
        <div className="memgraph__hint mono">
          {data.metas.length} neurons · scroll to zoom · drag empty space to pan · click a note to
          open · dashed = unresolved
        </div>
      )}
    </section>
  )
}
