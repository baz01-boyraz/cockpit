import type { MemoryHubSnapshot } from '@shared/memory-hub'
import type { ForceEdge } from '@shared/forceGraph'
import { cockpit } from '../../lib/cockpit'
import type { GraphData, GraphNodeMeta, Tier, VMeta } from './memoryGraphModel'
import { hash01, makeGlowSprite, makePulseSprite, type Palette } from './memoryGraphPaint'

/**
 * Data-to-layout adapter — turns a hub snapshot into render-ready metas + edges,
 * and derives the per-node visual identity (tier, colour, glow sprite, idle-life
 * phases). The neighbour index and tier sprites live here too: everything that
 * maps "what the hub contains" onto "what the canvas needs", once per graph.
 */

export const nodeRadius = (connections: number): number => Math.min(6 + connections * 1.3, 14)

/** Edges from per-note outgoing links; ghosts from the unresolved aggregate. */
export async function loadGraph(
  projectId: string,
  snapshot: MemoryHubSnapshot,
): Promise<GraphData> {
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

/** Undirected adjacency index — used for hover focus + degree. */
export function buildNeighbors(edges: ForceEdge[]): Map<string, Set<string>> {
  const neighbors = new Map<string, Set<string>>()
  for (const e of edges) {
    if (!neighbors.has(e.source)) neighbors.set(e.source, new Set())
    if (!neighbors.has(e.target)) neighbors.set(e.target, new Set())
    neighbors.get(e.source)!.add(e.target)
    neighbors.get(e.target)!.add(e.source)
  }
  return neighbors
}

export interface TierSprites {
  sprites: Record<Tier, HTMLCanvasElement>
  pulseEmber: HTMLCanvasElement
  pulseGlacier: HTMLCanvasElement
}

/** One glow sprite per colour tier + the two travelling-pulse sprites. */
export function buildTierSprites(palette: Palette): TierSprites {
  return {
    sprites: {
      amber: makeGlowSprite(palette.ember3, palette.emberHot),
      ember: makeGlowSprite(palette.ember4, palette.ember3),
      glacier: makeGlowSprite(palette.glacier4, palette.glacier3),
      ghost: makeGlowSprite(palette.ember7, palette.ember5),
    },
    pulseEmber: makePulseSprite(palette.ember4, palette.ember3),
    pulseGlacier: makePulseSprite(palette.glacier4, palette.glacier3),
  }
}

/** Per-node visual identity + idle-life phases, keyed by node id. */
export function buildVMeta(
  metas: GraphNodeMeta[],
  neighbors: Map<string, Set<string>>,
  sprites: Record<Tier, HTMLCanvasElement>,
  palette: Palette,
): Map<string, VMeta> {
  const degreeOf = (id: string): number => neighbors.get(id)?.size ?? 0
  const maxDeg = Math.max(1, ...metas.map((m) => degreeOf(m.id)))
  const vById = new Map<string, VMeta>()
  for (const meta of metas) {
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
  return vById
}
