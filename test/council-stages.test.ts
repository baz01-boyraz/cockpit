import { describe, expect, it } from 'vitest'
import {
  COUNCIL_STAGE_BUDGETS,
  councilLanguageInstruction,
  detectCouncilResponseLanguage,
  normalizeCouncilChairmanText,
  normalizeCouncilRankingText,
  normalizeCouncilSeatText,
} from '../shared/council-stages'

describe('Council stage language contract', () => {
  it('detects Turkish even when the author mostly types without diacritics', () => {
    expect(
      detectCouncilResponseLanguage(
        'Memory sistemini daha sade ve guvenilir yapmak icin hangi katmanlari degistirmeliyiz?',
      ),
    ).toBe('tr')
    expect(detectCouncilResponseLanguage('Refactor the cache and document the rollback path.')).toBe(
      'en',
    )
  })

  it('honours an explicit safe language tag and keeps machine labels stable', () => {
    expect(detectCouncilResponseLanguage('Turkish request', 'de-DE')).toBe('de-DE')
    expect(councilLanguageInstruction('tr')).toContain('Human prose language: Turkish (tr)')
    expect(councilLanguageInstruction('tr')).toContain('machine labels')
  })
})

describe('Council seat envelope', () => {
  it('parses, field-bounds, and renders only complete structured findings', () => {
    const raw = [
      'Free-form preamble that must not survive canonicalization.',
      ...Array.from({ length: 7 }, (_, index) => [
        `FINDING ${index + 1}: ${`finding-${index} `.repeat(80)}`,
        `IMPACT: ${`impact-${index} `.repeat(70)}`,
        `RECOMMENDATION: ${`recommendation-${index} `.repeat(60)}`,
        `BASIS: ${index % 2 === 0 ? 'EVIDENCE' : 'INFERENCE'}`,
        `EVIDENCE: src/module-${index}.ts:42`,
      ].join('\n')),
    ].join('\n\n')

    const normalized = normalizeCouncilSeatText(raw)

    expect(normalized.findings.length).toBeGreaterThan(0)
    expect(normalized.findings.length).toBeLessThanOrEqual(
      COUNCIL_STAGE_BUDGETS.seat.maxFindings,
    )
    expect(normalized.text.length).toBeLessThanOrEqual(
      COUNCIL_STAGE_BUDGETS.seat.outputChars,
    )
    expect(normalized.text).not.toContain('Free-form preamble')
    expect(normalized.text.match(/^FINDING \d+:/gm)).toHaveLength(normalized.findings.length)
    expect(normalized.text.match(/^EVIDENCE:/gm)).toHaveLength(normalized.findings.length)
    expect(normalized.truncated).toBe(true)
  })

  it('accepts legacy prose during transition but hard-caps it visibly', () => {
    const normalized = normalizeCouncilSeatText(
      `Legacy prose. ${'verbose '.repeat(COUNCIL_STAGE_BUDGETS.seat.outputChars)}`,
    )

    expect(normalized.findings).toEqual([])
    expect(normalized.text.length).toBeLessThanOrEqual(
      COUNCIL_STAGE_BUDGETS.seat.outputChars,
    )
    expect(normalized.text).toContain('truncated')
    expect(normalized.truncated).toBe(true)
  })
})

describe('Council compact peer judgment', () => {
  it('drops ranking essays and preserves only the bounded machine fields', () => {
    const raw = [
      `Long ranking essay that should disappear. ${'essay '.repeat(500)}`,
      'STRONGEST CONTRIBUTION: Response B — Found the rollback gap.',
      'COLLECTIVE GAP: Nobody tested a crash between journal append and commit.',
      'FACTUALITY FLAGS:',
      '- Response A claims a table exists without evidence.',
      '- Response C cites no file.',
      'FINAL RANKING:',
      '1. Response B',
      '2. Response A',
      '3. Response C',
    ].join('\n')

    const normalized = normalizeCouncilRankingText(raw)

    expect(normalized.parsed).toEqual(['Response B', 'Response A', 'Response C'])
    expect(normalized.strongestContribution).toContain('Response B')
    expect(normalized.collectiveGap).toContain('journal append')
    expect(normalized.factualityFlags).toHaveLength(2)
    expect(normalized.text).not.toContain('Long ranking essay')
    expect(normalized.text.length).toBeLessThanOrEqual(
      COUNCIL_STAGE_BUDGETS.ranking.outputChars,
    )
  })

  it('normalizes a legacy FINAL RANKING block without inventing peer claims', () => {
    const normalized = normalizeCouncilRankingText(
      'I liked C.\nFINAL RANKING:\n1. Response C\n2. Response A',
    )

    expect(normalized).toMatchObject({
      parsed: ['Response C', 'Response A'],
      strongestContribution: null,
      collectiveGap: null,
      factualityFlags: [],
    })
    expect(normalized.text).toBe('FINAL RANKING:\n1. Response C\n2. Response A')
  })
})

describe('Council chairman output budget', () => {
  it('caps an overlong spec synthesis by section without losing gate fields', () => {
    const raw = [
      '### ⚖️ Consensus & Disagreement',
      'Kısa ortak görüş. ' + 'uzun '.repeat(2_000),
      '### 🎯 Verdict',
      'NEEDS_CLARIFICATION',
      'İki ürün kararı eksik. ' + 'neden '.repeat(1_000),
      '### 📋 Refined Spec',
      '**Goal** Güvenli migration.\n' + 'detay '.repeat(5_000),
      '### ❓ Questions for the author',
      '1. QUESTION: Saklama süresi ne olmalı?',
      '   WHY: Cleanup davranışını değiştirir.',
      '   RECOMMENDED: 30 gün kullanın.',
    ].join('\n')

    const normalized = normalizeCouncilChairmanText(raw, 'spec')

    expect(normalized.length).toBeLessThanOrEqual(
      COUNCIL_STAGE_BUDGETS.chairman.outputChars,
    )
    expect(normalized).toContain('### 🎯 Verdict\nNEEDS_CLARIFICATION')
    expect(normalized).toContain('### 📋 Refined Spec')
    expect(normalized).toContain('### ❓ Questions for the author')
    expect(normalized).toContain('RECOMMENDED: 30 gün kullanın.')
    expect(normalized).toContain('truncated')
  })

  it('preserves every required diff heading under the output cap', () => {
    const normalized = normalizeCouncilChairmanText(
      [
        '### ⚖️ Consensus & Disagreement',
        'risk '.repeat(5_000),
        '### 🎯 Verdict',
        'CHANGES REQUESTED. Add containment.',
        '### ➡️ Next step',
        'Add the rollback test today.',
      ].join('\n'),
      'diff',
    )

    expect(normalized).toContain('### ⚖️ Consensus & Disagreement')
    expect(normalized).toContain('### 🎯 Verdict')
    expect(normalized).toContain('### ➡️ Next step')
    expect(normalized.length).toBeLessThanOrEqual(
      COUNCIL_STAGE_BUDGETS.chairman.outputChars,
    )
  })
})
