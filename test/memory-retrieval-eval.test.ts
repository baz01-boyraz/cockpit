import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { buildMemoryContext } from '@shared/memory-context'
import {
  evaluateMemoryRetrievalCorpus,
  validateMemoryEvalCorpus,
  type MemoryEvalCorpus,
} from '@shared/memory-eval'

const fixturePath = resolve('test/fixtures/memory/retrieval-corpus.json')
const realRedactedFixturePath = resolve('test/fixtures/memory/retrieval-real-redacted.json')
const manifestScript = resolve('scripts/diagnostics/memory-manifest.mjs')
const retrievalScript = resolve('scripts/diagnostics/memory-retrieval-baseline.ts')
const tempRoots: string[] = []

function loadCorpus(): MemoryEvalCorpus {
  return JSON.parse(readFileSync(fixturePath, 'utf8')) as MemoryEvalCorpus
}

function loadRealRedactedCorpus(): MemoryEvalCorpus {
  return JSON.parse(readFileSync(realRedactedFixturePath, 'utf8')) as MemoryEvalCorpus
}

function inventory(root: string): string[] {
  return readdirSync(root, { recursive: true, withFileTypes: true })
    .map((entry) => `${entry.parentPath.slice(root.length)}/${entry.name}:${entry.isDirectory() ? 'dir' : entry.isSymbolicLink() ? 'link' : 'file'}`)
    .sort()
}

afterEach(() => {
  while (tempRoots.length > 0) rmSync(tempRoots.pop()!, { recursive: true, force: true })
})

describe('Memory R0 retrieval corpus', () => {
  it('is synthetic, balanced, frozen, and valid', () => {
    const corpus = loadCorpus()
    expect(validateMemoryEvalCorpus(corpus)).toEqual([])
    expect(corpus.schemaVersion).toBe(1)
    expect(corpus.sourceKind).toBe('synthetic')
    expect(corpus.cases).toHaveLength(72)
    expect(corpus.cases.filter((item) => item.language === 'en')).toHaveLength(36)
    expect(corpus.cases.filter((item) => item.language === 'tr')).toHaveLength(36)
    // New semantic cases are honest tune/regression probes. The original 30
    // holdout labels remain untouched; cases authored with this ranker are not
    // misrepresented as blind evaluation data merely to keep the split even.
    expect(corpus.cases.filter((item) => item.split === 'tune')).toHaveLength(42)
    expect(corpus.cases.filter((item) => item.split === 'holdout')).toHaveLength(30)
    expect(new Set(corpus.cases.map((item) => item.id)).size).toBe(72)
  })

  it('records deterministic top-k, no-match, and lifecycle safety baselines', () => {
    const corpus = loadCorpus()
    const first = evaluateMemoryRetrievalCorpus(corpus)
    const second = evaluateMemoryRetrievalCorpus(corpus)

    expect(second).toEqual(first)
    expect(first.caseCount).toBe(72)
    expect(first.positiveCases).toBe(62)
    expect(first.noMatchCases).toBe(10)
    expect(first.top3HitRate).toBeGreaterThan(0.8)
    expect(first.noMatchFalseInjections).toBe(0)
    const semanticCases = first.cases.filter((item) => item.category === 'semantic')
    expect(semanticCases).toHaveLength(12)
    expect(semanticCases.every((item) => item.top1Hit)).toBe(true)
    expect(semanticCases.every((item) => item.returned.length === 1)).toBe(true)
    expect(first.unsafeSelections).toEqual([])
  })

  it('retrieves redacted notes from real Turkish project-query shapes', () => {
    const corpus = loadRealRedactedCorpus()
    expect(validateMemoryEvalCorpus(corpus)).toEqual([])

    const report = evaluateMemoryRetrievalCorpus(corpus)
    const matchedCases = report.cases.filter((item) => item.category !== 'no_match')
    expect(report.caseCount).toBe(8)
    expect(report.sourceKind).toBe('local-redacted')
    expect(matchedCases.every((item) => item.top1Hit)).toBe(true)
    expect(report.noMatchFalseInjections).toBe(0)
    expect(report.unsafeSelections).toEqual([])
  })

  it('rejects malformed labels and never includes query or hook prose in a report', () => {
    const corpus = loadCorpus()
    const malformed = structuredClone(corpus)
    malformed.cases[0].expectedTop3 = ['missing-note']
    expect(validateMemoryEvalCorpus(malformed)).toContain(
      `unknown note missing-note in case ${malformed.cases[0].id}`,
    )

    const report = evaluateMemoryRetrievalCorpus(corpus)
    const serialized = JSON.stringify(report)
    expect(serialized).not.toContain(corpus.cases[0].query)
    expect(serialized).not.toContain(corpus.notes[0].hook)
  })

  it('returns actionable validation errors for malformed runtime JSON', () => {
    const malformed = {
      schemaVersion: 2,
      sourceKind: 'remote',
      notes: [
        { name: 'duplicate', hook: 42, status: '', eligible: 'yes' },
        { name: 'duplicate', hook: null, status: 'active', eligible: true },
      ],
      cases: [
        {
          id: 'same',
          split: 'other',
          language: 'de',
          category: 'other',
          severity: 'urgent',
          query: '',
          expectedTop3: 'duplicate',
          forbiddenNotes: 'duplicate',
        },
        {
          id: 'same',
          split: 'tune',
          language: 'en',
          category: 'no_match',
          severity: 'high',
          query: 'query',
          expectedTop3: ['duplicate'],
          forbiddenNotes: ['missing'],
          expectNoMatch: true,
        },
      ],
    } as unknown as MemoryEvalCorpus
    const errors = validateMemoryEvalCorpus(malformed)

    expect(errors).toEqual(expect.arrayContaining([
      'schemaVersion must be 1',
      'sourceKind must be synthetic or local-redacted',
      'duplicate note: duplicate',
      'note duplicate has invalid hook',
      'note duplicate needs status',
      'note duplicate needs eligible:boolean',
      'invalid split: same',
      'invalid language: same',
      'invalid category: same',
      'invalid severity: same',
      'empty query: same',
      'expectedTop3 must be an array: same',
      'forbiddenNotes must be an array: same',
      'non-no-match case same needs expectedTop3',
      'duplicate case: same',
      'no-match case same cannot have expectedTop3',
      'unknown note missing in case same',
    ]))
    expect(validateMemoryEvalCorpus({
      schemaVersion: 1,
      sourceKind: 'synthetic',
      notes: [],
      cases: [],
    })).toEqual(['notes must not be empty', 'cases must not be empty'])
  })

  it('keeps misses, unsafe selections, and no-match injections as separate failures', () => {
    const corpus = loadCorpus()
    const report = evaluateMemoryRetrievalCorpus(corpus, (query) => [{
      name: query.startsWith('quantum') ? 'unknown-note' : 'archived-heroku-deploy',
      hook: null,
    }])

    expect(report.top1HitRate).toBe(0)
    expect(report.top3HitRate).toBe(0)
    expect(report.misses).toHaveLength(62)
    expect(report.noMatchFalseInjections).toBe(10)
    expect(report.unsafeSelections.length).toBeGreaterThan(0)
  })

  it('exposes the same content-free retrieval scorecard through a read-only CLI', () => {
    const before = readFileSync(fixturePath, 'utf8')
    const first = execFileSync(
      process.execPath,
      ['--import', 'tsx', retrievalScript, '--input', fixturePath],
      { cwd: process.cwd(), encoding: 'utf8' },
    )
    const second = execFileSync(
      process.execPath,
      ['--import', 'tsx', retrievalScript, '--input', fixturePath],
      { cwd: process.cwd(), encoding: 'utf8' },
    )
    const report = JSON.parse(first) as ReturnType<typeof evaluateMemoryRetrievalCorpus>

    expect(second).toBe(first)
    expect(readFileSync(fixturePath, 'utf8')).toBe(before)
    expect(report.caseCount).toBe(72)
    expect(report.noMatchFalseInjections).toBe(0)
    expect(first).not.toContain(loadCorpus().cases[0].query)
    expect(first).not.toContain(loadCorpus().notes[0].hook)
  })

  it('keeps tool-less context bounded and injects nothing for a no-match query', () => {
    const corpus = loadCorpus()
    const docs = corpus.notes.map((note, index) => ({
      name: note.name,
      content: note.hook ?? '',
      updatedAt: new Date(Date.UTC(2026, 6, 11, 0, 0, index)).toISOString(),
    }))
    const noMatch = corpus.cases.find((item) => item.expectNoMatch)
    expect(noMatch).toBeDefined()

    const empty = buildMemoryContext({
      contextId: 'r0_no_match',
      surface: 'council_spec',
      query: noMatch!.query,
      docs,
    })
    const bounded = buildMemoryContext({
      contextId: 'r0_bounded',
      surface: 'council_spec',
      query: 'memory retrieval context',
      docs,
    })

    expect(empty.block).toBe('')
    expect(empty.receipt.delivery).toBe('none')
    expect(bounded.receipt.notes.length).toBeLessThanOrEqual(2)
    expect(bounded.block.length).toBeLessThanOrEqual(1_200)
  })
})

describe('read-only memory manifest CLI', () => {
  it('reports hashes and quality findings without mutating or leaking note bodies', () => {
    const root = mkdtempSync(join(tmpdir(), 'cockpit-r0-manifest-'))
    tempRoots.push(root)
    const hub = join(root, '.cockpit-memory')
    mkdirSync(join(hub, '.snapshots', '2026-07-10T00-00-00-000Z-abcd1234'), { recursive: true })
    mkdirSync(join(hub, '.snapshots', '2026-07-11T00-00-00-000Z-efab5678'), { recursive: true })

    const alpha = [
      '---',
      'schema: 1',
      'name: alpha-note',
      'title: Alpha note',
      'class: reference',
      'gate: manual',
      'updatedAt: 2026-07-11T00:00:00.000Z',
      '---',
      '',
      '# Alpha note',
      '',
      'PRIVATE SYNTHETIC BODY must never appear in the manifest.',
      '- (2026-07-10) Repeated durable fact.',
      '- (2026-07-11) Repeated durable fact.',
      '',
      'Related: [[missing-target]]',
    ].join('\n')
    const malformed = ['---', 'schema: 1', 'name: broken-note', '---', '', 'broken'].join('\n')
    writeFileSync(join(hub, 'alpha-note.md'), alpha, 'utf8')
    writeFileSync(join(hub, 'broken-note.md'), malformed, 'utf8')
    const outside = join(root, 'outside.md')
    writeFileSync(outside, 'outside content', 'utf8')
    symlinkSync(outside, join(hub, 'linked-note.md'))
    const reviews = join(root, 'reviews.json')
    writeFileSync(reviews, JSON.stringify([{ status: 'pending' }, { status: 'accepted' }]), 'utf8')
    const before = inventory(root)

    const stdout = execFileSync(
      process.execPath,
      [manifestScript, '--hub', hub, '--reviews', reviews],
      { cwd: process.cwd(), encoding: 'utf8' },
    )
    const second = execFileSync(
      process.execPath,
      [manifestScript, '--hub', hub, '--reviews', reviews],
      { cwd: process.cwd(), encoding: 'utf8' },
    )
    const report = JSON.parse(stdout) as {
      schemaVersion: number
      noteCount: number
      totalBytes: number
      latestSnapshotId: string | null
      pendingReviewCount: number | null
      invalidFrontmatter: string[]
      repeatedFacts: { note: string; count: number }[]
      unresolvedLinks: { target: string; wantedBy: string[] }[]
      ignoredSymlinks: string[]
      notes: { name: string; bytes: number; sha256: string; frontmatter: string }[]
    }

    expect(second).toBe(stdout)
    expect(inventory(root)).toEqual(before)
    expect(report.schemaVersion).toBe(1)
    expect(report.noteCount).toBe(2)
    expect(report.totalBytes).toBe(Buffer.byteLength(alpha) + Buffer.byteLength(malformed))
    expect(report.latestSnapshotId).toBe('2026-07-11T00-00-00-000Z-efab5678')
    expect(report.pendingReviewCount).toBe(1)
    expect(report.invalidFrontmatter).toEqual(['broken-note'])
    expect(report.repeatedFacts).toContainEqual({ note: 'alpha-note', count: 2 })
    expect(report.unresolvedLinks).toContainEqual({
      target: 'missing-target',
      wantedBy: ['alpha-note'],
    })
    expect(report.ignoredSymlinks).toEqual(['linked-note.md'])
    expect(report.notes).toContainEqual({
      name: 'alpha-note',
      bytes: Buffer.byteLength(alpha),
      sha256: createHash('sha256').update(alpha).digest('hex'),
      frontmatter: 'valid',
    })
    expect(stdout).not.toContain('PRIVATE SYNTHETIC BODY')
    expect(stdout).not.toContain('outside content')
  })
})
