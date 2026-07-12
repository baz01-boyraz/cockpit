import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { normalizeCouncilResult, type CouncilResultV3 } from '@shared/council'
import { CouncilVerdict, CouncilVerdictEvidence } from './CouncilVerdict'

const HASH = 'a'.repeat(64)

function analysisResult() {
  const raw: CouncilResultV3 = {
    schemaVersion: 3,
    ok: true,
    mode: 'analysis',
    responseLanguage: 'en',
    decision: {
      kind: 'analysis_complete',
      summary: 'The repository analysis is ready.',
      why: null,
      questions: [],
      keyFindings: ['The renderer uses a project-scoped store.'],
      dissent: [],
    },
    primaryArtifact: {
      kind: 'analysisReport',
      content: '# Repository Analysis\n\nOne grounded finding.',
    },
    execution: {
      stats: { seatsRun: 5, seatsFailed: 0, filesReviewed: 1, durationMs: 40 },
    },
    evidence: {
      seats: [],
      rankings: [],
      aggregate: [],
      labelToSeat: {},
      rawChairman: null,
      analysis: {
        pack: {
          schemaVersion: 1,
          repository: {
            workspaceHash: HASH,
            manifestHash: HASH,
            headRef: 'main@abc1234',
            filesVisited: 12,
            filesRead: 4,
            canonicalMemoryMdPresent: false,
          },
          sources: [
            {
              id: 'repo-001',
              kind: 'repository',
              label: 'src/store/useStore.ts:1-24',
              path: 'src/store/useStore.ts',
              content: 'SECRET CONTENT MUST NEVER RENDER',
              startLine: 1,
              endLine: 24,
              sha256: HASH,
              updatedAt: null,
              truncated: false,
              injectionSuspect: false,
            },
            {
              id: 'repo-002',
              kind: 'repository',
              label: 'src/unused.ts:1-3',
              path: 'src/unused.ts',
              content: 'UNUSED CONTENT MUST NEVER RENDER',
              startLine: 1,
              endLine: 3,
              sha256: HASH,
              updatedAt: null,
              truncated: false,
              injectionSuspect: false,
            },
          ],
          unknowns: ['Runtime behavior was not executed.'],
          totalChars: 62,
          truncated: false,
        },
        claims: [
          {
            id: 'claim-001',
            source: 'repository',
            text: 'The renderer uses a project-scoped store.',
            evidenceRefs: ['repo-001'],
            verified: true,
          },
        ],
        egress: {
          policy: 'account-models',
          consent: true,
          allowedEngines: ['claude', 'codex'],
          contentChars: 100,
        },
      },
    },
    error: null,
    sessionId: 'analysis-001',
  }
  return normalizeCouncilResult(raw)!
}

describe('CouncilVerdictEvidence analysis provenance', () => {
  it('shows only cited source metadata and never renders collected source bodies', () => {
    const html = renderToStaticMarkup(
      createElement(CouncilVerdictEvidence, { result: analysisResult() }),
    )
    const text = html.replace(/<[^>]+>/g, '')

    expect(html).toContain('Sources used')
    expect(html).toContain('src/store/useStore.ts')
    expect(html).toContain('repo-001')
    expect(text).toContain('1 source-backed claim')
    expect(html).toContain('Claude + Codex accounts')
    expect(html).not.toContain('src/unused.ts')
    expect(html).not.toContain('SECRET CONTENT MUST NEVER RENDER')
    expect(html).not.toContain('UNUSED CONTENT MUST NEVER RENDER')
  })
})

describe('CouncilVerdict consumption hierarchy', () => {
  it('keeps only five acceptance checks in the default decision brief', () => {
    const criteria = Array.from({ length: 9 }, (_, index) => `${index + 1}. Check ${index + 1}`)
    const raw: CouncilResultV3 = {
      ...analysisResult(),
      mode: 'spec',
      responseLanguage: 'en',
      decision: {
        kind: 'approved',
        summary: 'The brief is buildable.',
        why: null,
        questions: [],
        keyFindings: [],
        dissent: [],
      },
      primaryArtifact: {
        kind: 'refinedSpec',
        content: `**Goal** Make Council easy to consume.\n**Acceptance criteria** ${criteria.join(' ')}`,
      },
      evidence: {
        seats: [],
        rankings: [],
        aggregate: [],
        labelToSeat: {},
        rawChairman: null,
      },
    }
    const result = normalizeCouncilResult(raw)!
    const html = renderToStaticMarkup(
      createElement(CouncilVerdict, { result, showEvidence: false }),
    )

    expect(html.match(/councilAction__criterionPreview/g)).toHaveLength(5)
    expect(html).toContain('4 more checks')
  })

  it('shows a bounded decision brief for repository analysis before the full report', () => {
    const raw = analysisResult()
    const result = normalizeCouncilResult({
      ...raw,
      decision: {
        ...raw.decision,
        keyFindings: Array.from({ length: 8 }, (_, index) => `Finding ${index + 1}`),
      },
    })!
    const html = renderToStaticMarkup(
      createElement(CouncilVerdict, { result, showEvidence: false }),
    )

    expect(html).toContain('Decision brief')
    expect(html.match(/councilAction__finding/g)).toHaveLength(5)
    expect(html).toContain('3 more findings in the full report')
  })
})
