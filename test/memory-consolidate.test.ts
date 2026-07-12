import { describe, expect, it } from 'vitest'
import { analyzeConsolidation } from '@shared/memory-consolidate'
import type { MemoryDoc } from '@shared/memory-hub'

const doc = (name: string, content: string): MemoryDoc => ({
  name,
  content,
  updatedAt: '2026-07-04T10:00:00Z',
})

describe('analyzeConsolidation', () => {
  it('pairs near-duplicate notes, each note used once', () => {
    const docs = [
      doc('a', 'the router lives in shared so both bridges classify identically'),
      doc('b', 'the router lives in shared so both bridges classify identically here'),
      doc('c', 'a totally unrelated fact about railway deployment tokens'),
    ]
    const report = analyzeConsolidation(docs)
    expect(report.duplicates).toHaveLength(1)
    expect(report.duplicates[0].slugs.sort()).toEqual(['a', 'b'])
  })

  it('flags oversized notes', () => {
    const report = analyzeConsolidation([doc('big', 'x'.repeat(200))], { oversizeBytes: 100 })
    expect(report.oversized).toHaveLength(1)
    expect(report.oversized[0].slug).toBe('big')
  })

  it('dry-runs repeated atomic facts inside one note without mutating it', () => {
    const content = `# Swarm history

- (2026-07-04) A cleanup pass snapshots the full memory hub before it changes any durable note.
- A separate fact about worker completion remains useful and must stay.
- (2026-07-06) A cleanup pass snapshots the full memory hub before it changes any durable note.

Related: [[memory-hub]]`
    const memory = doc('swarm-history', content)

    const report = analyzeConsolidation([memory], { oversizeBytes: 100 })

    expect(memory.content).toBe(content)
    expect(report.repetitions).toEqual([
      expect.objectContaining({
        kind: 'repetition',
        slug: 'swarm-history',
        canonicalFact: 'A cleanup pass snapshots the full memory hub before it changes any durable note.',
        repeatedFact: 'A cleanup pass snapshots the full memory hub before it changes any durable note.',
        similarity: 1,
      }),
    ])
  })

  it('reports every repeated copy against one canonical fact', () => {
    const repeated = 'The memory cleanup report is reviewable before any note is rewritten or archived.'
    const report = analyzeConsolidation([
      doc('history', `- ${repeated}\n- ${repeated}\n- ${repeated}\n- ${repeated}`),
    ])

    expect(report.repetitions).toHaveLength(3)
    expect(report.repetitions.every((finding) => finding.canonicalFact === repeated)).toBe(true)
  })

  it('ignores tiny boilerplate and Related navigation when looking for repetitions', () => {
    const report = analyzeConsolidation([
      doc('small', '- keep safe\n- keep safe\n\nRelated: [[ghost]], [[ghost]]'),
    ])

    expect(report.repetitions).toEqual([])
  })

  it('lists dangling links wanted by notes', () => {
    const report = analyzeConsolidation([doc('a', 'see [[ghost-note]] for details')])
    expect(report.dangling).toHaveLength(1)
    expect(report.dangling[0].target).toBe('ghost-note')
    expect(report.dangling[0].wantedBy).toEqual(['a'])
  })

  it('is empty for a clean, small, well-linked hub', () => {
    const docs = [doc('a', 'unique alpha content about the router'), doc('b', 'unique beta content about railway')]
    const report = analyzeConsolidation(docs)
    expect(report.duplicates).toEqual([])
    expect(report.oversized).toEqual([])
    expect(report.repetitions).toEqual([])
    expect(report.dangling).toEqual([])
  })

  it('does not overlap a note across two duplicate pairs', () => {
    const same = 'identical body text shared across three separate notes verbatim'
    const docs = [doc('a', same), doc('b', same), doc('c', same)]
    const report = analyzeConsolidation(docs)
    // 3 identical notes → one pair (2 notes), the third left for the next pass
    expect(report.duplicates).toHaveLength(1)
  })
})
