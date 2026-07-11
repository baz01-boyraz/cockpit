import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const fixturePath = resolve('test/fixtures/council/synthetic-sessions.json')
const scriptPath = resolve('scripts/diagnostics/council-baseline.mjs')

interface CouncilBaselineReport {
  schemaVersion: number
  sourceKind: string
  caseCount: number
  splits: { tune: number; holdout: number }
  logicalCalls: number
  minimumPhysicalAttempts: number
  requiredSignals: { matched: number; total: number; recall: number }
  forbiddenClaimHits: { caseId: string; claim: string }[]
  intentMismatches: string[]
  measurementGaps: string[]
  cases: { id: string }[]
}

function runBaseline(): CouncilBaselineReport {
  const stdout = execFileSync(process.execPath, [scriptPath, '--input', fixturePath], {
    cwd: process.cwd(),
    encoding: 'utf8',
  })
  return JSON.parse(stdout) as CouncilBaselineReport
}

describe('Council R0 synthetic baseline', () => {
  it('keeps a balanced, explicitly synthetic tune/holdout corpus', () => {
    const corpus = JSON.parse(readFileSync(fixturePath, 'utf8')) as {
      schemaVersion: number
      sourceKind: string
      cases: { id: string; split: string; language: string }[]
    }
    expect(corpus.schemaVersion).toBe(1)
    expect(corpus.sourceKind).toBe('synthetic')
    expect(new Set(corpus.cases.map((item) => item.id)).size).toBe(corpus.cases.length)
    expect(corpus.cases.filter((item) => item.split === 'tune')).toHaveLength(3)
    expect(corpus.cases.filter((item) => item.split === 'holdout')).toHaveLength(3)
    expect(new Set(corpus.cases.map((item) => item.language))).toEqual(new Set(['en', 'tr']))
  })

  it('produces deterministic, content-free baseline metrics', () => {
    const before = readFileSync(fixturePath, 'utf8')
    const first = runBaseline()
    const second = runBaseline()

    expect(second).toEqual(first)
    expect(readFileSync(fixturePath, 'utf8')).toBe(before)
    expect(first.schemaVersion).toBe(1)
    expect(first.sourceKind).toBe('synthetic')
    expect(first.caseCount).toBe(6)
    expect(first.splits).toEqual({ tune: 3, holdout: 3 })
    expect(first.logicalCalls).toBeGreaterThan(0)
    expect(first.minimumPhysicalAttempts).toBeGreaterThan(first.logicalCalls)
    expect(first.requiredSignals.recall).toBeGreaterThan(0)
    expect(first.intentMismatches).toContain('analysis-memory-research-tr')
    expect(first.forbiddenClaimHits).toContainEqual({
      caseId: 'analysis-memory-research-tr',
      claim: 'canonical memory.md',
    })
    expect(first.measurementGaps).toEqual(
      expect.arrayContaining(['physical_attempts', 'chairman_engine', 'stage_tokens']),
    )
    expect(first.cases.map((item) => item.id)).toEqual([...first.cases.map((item) => item.id)].sort())
    expect(JSON.stringify(first)).not.toContain('Provider convergence must be visible.')
    expect(JSON.stringify(first)).not.toContain('Markdown files are the source of truth.')
  })

  it('supports a prose-free, local-redacted real-session contract', () => {
    const root = mkdtempSync(resolve(tmpdir(), 'cockpit-council-redacted-'))
    const input = resolve(root, 'redacted.json')
    const corpus = {
      schemaVersion: 1,
      sourceKind: 'local-redacted',
      cases: [{
        id: 'real-memory-analysis',
        split: 'holdout',
        language: 'tr',
        severity: 'critical',
        expectedIntent: 'analysis',
        observedMode: 'spec',
        requiredSignals: ['memory-source-truth', 'bounded-retrieval'],
        observedSignals: ['memory-source-truth'],
        forbiddenClaims: ['canonical-memory-index'],
        observedForbiddenClaims: ['canonical-memory-index'],
        redactedMetrics: {
          seats: 5,
          failedSeats: 0,
          rankings: 5,
          fallbackSeats: 4,
          logicalCalls: 11,
          minimumPhysicalAttempts: 15,
          generatedCharacters: 56_341,
          resultBytes: 60_054,
          durationMs: 345_683,
          providers: ['claude', 'openrouter'],
          hasVerdict: true,
          refinedSpecHeadingCount: 1,
        },
      }],
    }
    writeFileSync(input, JSON.stringify(corpus), 'utf8')

    try {
      const stdout = execFileSync(process.execPath, [scriptPath, '--input', input], {
        cwd: process.cwd(),
        encoding: 'utf8',
      })
      const report = JSON.parse(stdout) as CouncilBaselineReport & {
        generatedCharacters: number
        resultBytes: number
        durationMs: number
      }
      expect(report.sourceKind).toBe('local-redacted')
      expect(report.logicalCalls).toBe(11)
      expect(report.minimumPhysicalAttempts).toBe(15)
      expect(report.generatedCharacters).toBe(56_341)
      expect(report.resultBytes).toBe(60_054)
      expect(report.durationMs).toBe(345_683)
      expect(report.intentMismatches).toEqual(['real-memory-analysis'])
      expect(report.requiredSignals).toEqual({ matched: 1, total: 2, recall: 0.5 })
      expect(report.forbiddenClaimHits).toEqual([
        { caseId: 'real-memory-analysis', claim: 'canonical-memory-index' },
      ])
      expect(report).not.toHaveProperty('verdict')
      expect(report).not.toHaveProperty('question')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
