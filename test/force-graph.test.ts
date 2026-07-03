import { describe, expect, it } from 'vitest'
import {
  defaultForceConfig,
  seedPositions,
  simulate,
  tick,
  type ForceEdge,
  type ForceNode,
} from '@shared/forceGraph'

const node = (id: string, x: number, y: number, pinned = false): ForceNode => ({
  id,
  x,
  y,
  vx: 0,
  vy: 0,
  pinned,
})

const dist = (a: ForceNode, b: ForceNode): number => Math.hypot(a.x - b.x, a.y - b.y)

const config = defaultForceConfig(400, 300)

describe('seedPositions', () => {
  it('is deterministic and gives every node a distinct spot', () => {
    const ids = ['a', 'b', 'c', 'd', 'e']
    const first = seedPositions(ids, 400, 300)
    const second = seedPositions(ids, 400, 300)
    expect(second).toEqual(first)
    const keys = new Set(first.map((n) => `${n.x.toFixed(3)},${n.y.toFixed(3)}`))
    expect(keys.size).toBe(ids.length)
  })

  it('seeds around the requested center with zero velocity', () => {
    const seeded = seedPositions(['a', 'b', 'c'], 100, 50)
    for (const n of seeded) {
      expect(Math.hypot(n.x - 100, n.y - 50)).toBeLessThan(120)
      expect(n.vx).toBe(0)
      expect(n.vy).toBe(0)
      expect(n.pinned).toBe(false)
    }
  })
})

describe('tick', () => {
  it('pulls linked nodes that are stretched past the spring length together', () => {
    const nodes = [node('a', 100, 300), node('b', 700, 300)]
    const edges: ForceEdge[] = [{ source: 'a', target: 'b' }]
    const { nodes: next } = tick(nodes, edges, config)
    expect(dist(next[0], next[1])).toBeLessThan(dist(nodes[0], nodes[1]))
  })

  it('pushes unlinked nodes that sit too close apart', () => {
    const nodes = [node('a', 390, 300), node('b', 410, 300)]
    const { nodes: next } = tick(nodes, [], config)
    expect(dist(next[0], next[1])).toBeGreaterThan(dist(nodes[0], nodes[1]))
  })

  it('separates coincident nodes deterministically instead of dividing by zero', () => {
    const nodes = [node('a', 400, 300), node('b', 400, 300)]
    const run1 = tick(nodes, [], config)
    const run2 = tick(nodes, [], config)
    expect(dist(run1.nodes[0], run1.nodes[1])).toBeGreaterThan(0)
    expect(run1.nodes).toEqual(run2.nodes)
    for (const n of run1.nodes) {
      expect(Number.isFinite(n.x)).toBe(true)
      expect(Number.isFinite(n.y)).toBe(true)
    }
  })

  it('drifts a lone node toward the configured center', () => {
    const [before] = [node('a', 700, 500)]
    const { nodes: next } = tick([before], [], config)
    const beforeDist = Math.hypot(before.x - config.cx, before.y - config.cy)
    const afterDist = Math.hypot(next[0].x - config.cx, next[0].y - config.cy)
    expect(afterDist).toBeLessThan(beforeDist)
  })

  it('never moves a pinned node but still lets it push others', () => {
    const nodes = [node('a', 400, 300, true), node('b', 420, 300)]
    const { nodes: next } = tick(nodes, [], config)
    expect(next[0].x).toBe(400)
    expect(next[0].y).toBe(300)
    expect(next[1].x).toBeGreaterThan(420)
  })

  it('does not mutate its inputs', () => {
    const nodes = [node('a', 100, 100), node('b', 200, 200)]
    const snapshot = structuredClone(nodes)
    const edges: ForceEdge[] = [{ source: 'a', target: 'b' }]
    const edgeSnapshot = structuredClone(edges)
    tick(nodes, edges, config)
    expect(nodes).toEqual(snapshot)
    expect(edges).toEqual(edgeSnapshot)
  })

  it('ignores edges whose endpoints are unknown', () => {
    const nodes = [node('a', 100, 100)]
    const { nodes: next } = tick(nodes, [{ source: 'a', target: 'ghost-of-nobody' }], config)
    expect(Number.isFinite(next[0].x)).toBe(true)
  })
})

describe('simulate', () => {
  const ids = ['hub', 'alpha', 'beta', 'gamma', 'ghost']
  const edges: ForceEdge[] = [
    { source: 'hub', target: 'alpha' },
    { source: 'hub', target: 'beta' },
    { source: 'alpha', target: 'beta' },
    { source: 'beta', target: 'gamma' },
    { source: 'hub', target: 'ghost' },
  ]

  it('settles a small hub-shaped graph within the tick budget', () => {
    const result = simulate(seedPositions(ids, 400, 300), edges, config)
    expect(result.settled).toBe(true)
    expect(result.ticks).toBeLessThan(400)
  })

  it('is fully deterministic for identical inputs', () => {
    const a = simulate(seedPositions(ids, 400, 300), edges, config)
    const b = simulate(seedPositions(ids, 400, 300), edges, config)
    expect(a).toEqual(b)
  })

  it('ends with nodes spread apart — no overlap collapse', () => {
    const { nodes } = simulate(seedPositions(ids, 400, 300), edges, config)
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        expect(dist(nodes[i], nodes[j])).toBeGreaterThan(40)
      }
    }
  })

  it('keeps the settled layout near the center', () => {
    const { nodes } = simulate(seedPositions(ids, 400, 300), edges, config)
    for (const n of nodes) {
      expect(Math.hypot(n.x - 400, n.y - 300)).toBeLessThan(300)
    }
  })
})
