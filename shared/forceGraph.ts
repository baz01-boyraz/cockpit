/**
 * Tiny deterministic force-directed layout (VISION 5.5 — memory graph).
 *
 * Pure module (in shared/ per the repo rule: pure logic stays
 * runtime-dependency-free and node-testable): no DOM, no Math.random, no
 * dependencies. Callers supply the
 * initial positions (use `seedPositions` for a deterministic golden-angle
 * spiral) and step the simulation themselves — the animated canvas runs
 * `tick` per frame; reduced-motion callers run `simulate` synchronously and
 * draw the settled layout once. Every function returns new objects.
 */

export interface ForceNode {
  id: string
  x: number
  y: number
  vx: number
  vy: number
  /** Pinned nodes (e.g. while dragged) exert forces but never move. */
  pinned: boolean
}

export interface ForceEdge {
  source: string
  target: string
}

export interface ForceConfig {
  /** Pairwise repulsion constant (force ~ repulsion / d²). */
  repulsion: number
  /** Spring rest length for linked nodes, in px. */
  springLength: number
  springStrength: number
  /** Gentle pull toward (cx, cy) so disconnected clusters stay on screen. */
  centerStrength: number
  /** Velocity multiplier per tick, < 1 — this is what makes it settle. */
  damping: number
  cx: number
  cy: number
  /** Average per-node speed below which the layout counts as settled. */
  settleSpeed: number
}

export function defaultForceConfig(cx: number, cy: number): ForceConfig {
  return {
    repulsion: 30000,
    springLength: 155,
    springStrength: 0.035,
    centerStrength: 0.012,
    damping: 0.82,
    cx,
    cy,
    settleSpeed: 0.045,
  }
}

/** Golden-angle spiral seed — deterministic, distinct, roughly centered. */
export function seedPositions(
  ids: readonly string[],
  cx: number,
  cy: number,
  spread = 42,
): ForceNode[] {
  const GOLDEN_ANGLE = 2.399963229728653
  return ids.map((id, i) => {
    const angle = i * GOLDEN_ANGLE
    const radius = spread * Math.sqrt(i + 0.6)
    return {
      id,
      x: cx + radius * Math.cos(angle),
      y: cy + radius * Math.sin(angle),
      vx: 0,
      vy: 0,
      pinned: false,
    }
  })
}

export interface TickResult {
  nodes: ForceNode[]
  /** Average velocity magnitude across unpinned nodes after this tick. */
  speed: number
}

/** One integration step: repulsion + springs + centering, damped Euler. */
export function tick(
  nodes: readonly ForceNode[],
  edges: readonly ForceEdge[],
  config: ForceConfig,
): TickResult {
  const n = nodes.length
  const fx = new Array<number>(n).fill(0)
  const fy = new Array<number>(n).fill(0)
  const index = new Map<string, number>(nodes.map((node, i) => [node.id, i]))

  // Pairwise repulsion. Coincident nodes get a deterministic index-based nudge.
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      let dx = nodes[i].x - nodes[j].x
      let dy = nodes[i].y - nodes[j].y
      if (dx === 0 && dy === 0) {
        dx = 0.1 * (i + 1)
        dy = 0.1 * (j + 1)
      }
      const distSq = Math.max(dx * dx + dy * dy, 64)
      const dist = Math.sqrt(distSq)
      const force = config.repulsion / distSq
      const ux = dx / dist
      const uy = dy / dist
      fx[i] += ux * force
      fy[i] += uy * force
      fx[j] -= ux * force
      fy[j] -= uy * force
    }
  }

  // Springs along edges (unknown endpoints are ignored, defensively).
  for (const edge of edges) {
    const a = index.get(edge.source)
    const b = index.get(edge.target)
    if (a === undefined || b === undefined || a === b) continue
    const dx = nodes[b].x - nodes[a].x
    const dy = nodes[b].y - nodes[a].y
    const dist = Math.max(Math.sqrt(dx * dx + dy * dy), 1)
    const force = (dist - config.springLength) * config.springStrength
    const ux = dx / dist
    const uy = dy / dist
    fx[a] += ux * force
    fy[a] += uy * force
    fx[b] -= ux * force
    fy[b] -= uy * force
  }

  // Centering + integration.
  let totalSpeed = 0
  let moving = 0
  const next = nodes.map((node, i) => {
    if (node.pinned) return { ...node, vx: 0, vy: 0 }
    const ax = fx[i] + (config.cx - node.x) * config.centerStrength
    const ay = fy[i] + (config.cy - node.y) * config.centerStrength
    const vx = (node.vx + ax) * config.damping
    const vy = (node.vy + ay) * config.damping
    totalSpeed += Math.sqrt(vx * vx + vy * vy)
    moving += 1
    return { ...node, x: node.x + vx, y: node.y + vy, vx, vy }
  })

  return { nodes: next, speed: moving > 0 ? totalSpeed / moving : 0 }
}

export interface SimulateResult {
  nodes: ForceNode[]
  ticks: number
  settled: boolean
}

/** Run ticks until the layout settles (or maxTicks). Pure and deterministic. */
export function simulate(
  nodes: readonly ForceNode[],
  edges: readonly ForceEdge[],
  config: ForceConfig,
  maxTicks = 400,
): SimulateResult {
  let current: readonly ForceNode[] = nodes
  for (let t = 1; t <= maxTicks; t++) {
    const result = tick(current, edges, config)
    current = result.nodes
    if (result.speed < config.settleSpeed) {
      return { nodes: [...current], ticks: t, settled: true }
    }
  }
  return { nodes: [...current], ticks: maxTicks, settled: false }
}
