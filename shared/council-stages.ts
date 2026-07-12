/**
 * Pure Council stage contracts: language routing, structured-output parsing,
 * and deterministic post-response caps. Provider token enforcement belongs to
 * EngineRunner; these character caps apply to every engine and every persisted
 * result, including local CLIs that expose no completion-token flag.
 */
import {
  parseRankingFromText,
  parseSpecVerdict,
  type CouncilBuilderAssessment,
  type CouncilFinding,
  type CouncilFindingBasis,
  type CouncilMode,
} from './council'

export const COUNCIL_STAGE_BUDGETS = {
  seat: {
    maxTokens: 900,
    outputChars: 2_800,
    maxFindings: 4,
    findingChars: 240,
    impactChars: 180,
    recommendationChars: 220,
    evidenceChars: 180,
    builderFieldChars: 220,
  },
  ranking: {
    maxTokens: 400,
    outputChars: 1_200,
    strongestChars: 260,
    gapChars: 340,
    maxFactualityFlags: 3,
    factualityFlagChars: 180,
  },
  chairman: {
    maxTokens: 3_600,
    inputChars: 36_000,
    evidenceChars: 17_000,
    materialChars: 12_000,
    outputChars: 16_000,
    consensusChars: 600,
    verdictChars: 600,
    refinedSpecChars: 11_000,
    questionsChars: 2_400,
    nextStepChars: 1_000,
  },
} as const

export const COUNCIL_TRUNCATION_MARKER = '…[truncated by cockpiT]'

function bounded(text: string, cap: number): string {
  const clean = text.trim()
  if (clean.length <= cap) return clean
  const keep = Math.max(0, cap - COUNCIL_TRUNCATION_MARKER.length)
  return `${clean.slice(0, keep).trimEnd()}${COUNCIL_TRUNCATION_MARKER}`
}

function safeLanguageOverride(value: string | undefined): string | null {
  const clean = value?.trim()
  return clean && /^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/i.test(clean) ? clean.slice(0, 32) : null
}

const TURKISH_WORDS = new Set([
  've', 'bir', 'bu', 'icin', 'için', 'ile', 'olan', 'olarak', 'daha', 'nasil', 'nasıl',
  'neden', 'hangi', 'kullanici', 'kullanıcı', 'sistem', 'sistemi', 'gerekiyor', 'gerekir',
  'yapmak', 'etmek', 'degistir', 'değiştir', 'guvenilir', 'güvenilir', 'sade', 'sonra',
])

/** Deterministic, deliberately small language router; no model call or locale leak. */
export function detectCouncilResponseLanguage(text: string, override?: string): string {
  const explicit = safeLanguageOverride(override)
  if (explicit) return explicit
  const clean = text.toLowerCase()
  if (!clean.trim()) return 'und'
  const words = clean.match(/[\p{L}\p{N}]+/gu) ?? []
  const turkishScore = words.reduce((score, word) => score + Number(TURKISH_WORDS.has(word)), 0) +
    (/[çğıöşüÇĞİÖŞÜ]/.test(text) ? 4 : 0)
  return turkishScore >= 2 ? 'tr' : 'en'
}

export function councilLanguageInstruction(language: string): string {
  const label = language === 'tr'
    ? 'Turkish (tr)'
    : language === 'en'
      ? 'English (en)'
      : language === 'und'
        ? "the author's dominant language (default English when unclear)"
        : language
  return [
    `Human prose language: ${label}.`,
    'Keep all machine labels, enum tokens, and required markdown headings exactly in English.',
  ].join(' ')
}

function labelMatch(line: string, label: string): string | null {
  const clean = line.trim().replace(/^[-*+]\s+/, '')
  const match = new RegExp(
    `^(?:\\*\\*)?${label}(?:\\*\\*)?\\s*:\\s*(?:\\*\\*)?\\s*(.*)$`,
    'i',
  ).exec(clean)
  return match?.[1]?.replace(/\*\*$/, '').trim() ?? null
}

function findingBasis(value: string): CouncilFindingBasis {
  const token = value.trim().split(/[\s—–-]/)[0]?.toLowerCase()
  if (token === 'evidence') return 'evidence'
  if (token === 'inference') return 'inference'
  return 'unknown'
}

interface FindingDraft {
  finding: string | null
  impact: string | null
  recommendation: string | null
  basis: CouncilFindingBasis | null
  evidenceRef: string | null
  sawEvidence: boolean
}

function parseFindings(text: string): CouncilFinding[] {
  const out: CouncilFinding[] = []
  let current: FindingDraft | null = null
  const flush = () => {
    if (
      current?.finding &&
      current.impact &&
      current.recommendation &&
      current.basis &&
      current.sawEvidence
    ) {
      out.push({
        finding: bounded(current.finding, COUNCIL_STAGE_BUDGETS.seat.findingChars),
        impact: bounded(current.impact, COUNCIL_STAGE_BUDGETS.seat.impactChars),
        recommendation: bounded(
          current.recommendation,
          COUNCIL_STAGE_BUDGETS.seat.recommendationChars,
        ),
        basis: current.basis,
        evidenceRef:
          current.evidenceRef && !/^none$/i.test(current.evidenceRef)
            ? bounded(current.evidenceRef, COUNCIL_STAGE_BUDGETS.seat.evidenceChars)
            : null,
      })
    }
    current = null
  }

  for (const line of text.split('\n')) {
    const finding = labelMatch(line, 'FINDING(?:\\s+\\d+)?')
    if (finding !== null) {
      flush()
      current = {
        finding,
        impact: null,
        recommendation: null,
        basis: null,
        evidenceRef: null,
        sawEvidence: false,
      }
      continue
    }
    if (!current) continue
    const impact = labelMatch(line, 'IMPACT')
    if (impact !== null) {
      current.impact = impact
      continue
    }
    const recommendation = labelMatch(line, 'RECOMMENDATION')
    if (recommendation !== null) {
      current.recommendation = recommendation
      continue
    }
    const basis = labelMatch(line, 'BASIS')
    if (basis !== null) {
      current.basis = findingBasis(basis)
      continue
    }
    const evidence = labelMatch(line, 'EVIDENCE')
    if (evidence !== null) {
      current.evidenceRef = evidence
      current.sawEvidence = true
    }
  }
  flush()
  return out
}

function builderAssessment(text: string): CouncilBuilderAssessment | null {
  const find = (label: string): string | null => {
    for (const line of text.split('\n')) {
      const value = labelMatch(line, label)
      if (value !== null) {
        return value ? bounded(value, COUNCIL_STAGE_BUDGETS.seat.builderFieldChars) : null
      }
    }
    return null
  }
  const assessment: CouncilBuilderAssessment = {
    feasibility: find('FEASIBILITY'),
    effort: find('EFFORT'),
    plan: find('PLAN'),
    ambiguities: find('AMBIGUITIES'),
  }
  return Object.values(assessment).some((value) => value !== null) ? assessment : null
}

function renderFinding(finding: CouncilFinding, index: number): string {
  return [
    `FINDING ${index + 1}: ${finding.finding}`,
    `IMPACT: ${finding.impact}`,
    `RECOMMENDATION: ${finding.recommendation}`,
    `BASIS: ${finding.basis.toUpperCase()}`,
    `EVIDENCE: ${finding.evidenceRef ?? 'none'}`,
  ].join('\n')
}

function renderBuilderAssessment(value: CouncilBuilderAssessment | null): string | null {
  if (!value) return null
  return [
    `FEASIBILITY: ${value.feasibility ?? 'unknown'}`,
    `EFFORT: ${value.effort ?? 'unknown'}`,
    `PLAN: ${value.plan ?? 'not supplied'}`,
    `AMBIGUITIES: ${value.ambiguities ?? 'none supplied'}`,
  ].join('\n')
}

export interface NormalizedCouncilSeatText {
  text: string
  findings: CouncilFinding[]
  builderAssessment: CouncilBuilderAssessment | null
  truncated: boolean
}

/** Accept structured labels or legacy prose, then enforce one persisted cap. */
export function normalizeCouncilSeatText(
  value: string,
  opts: { builder?: boolean } = {},
): NormalizedCouncilSeatText {
  const raw = value.trim()
  const allFindings = parseFindings(raw)
  const parsed = allFindings.slice(0, COUNCIL_STAGE_BUDGETS.seat.maxFindings)
  const assessment = opts.builder ? builderAssessment(raw) : null
  if (parsed.length === 0) {
    const text = bounded(raw, COUNCIL_STAGE_BUDGETS.seat.outputChars)
    return {
      text,
      findings: [],
      builderAssessment: assessment,
      truncated: raw.length > COUNCIL_STAGE_BUDGETS.seat.outputChars,
    }
  }

  const appendix = renderBuilderAssessment(assessment)
  const selectFindings = (reserveMarker: boolean) => {
    const reserve =
      (appendix ? appendix.length + 2 : 0) +
      (reserveMarker ? COUNCIL_TRUNCATION_MARKER.length + 2 : 0)
    const available = Math.max(0, COUNCIL_STAGE_BUDGETS.seat.outputChars - reserve)
    const included: CouncilFinding[] = []
    const blocks: string[] = []
    for (const finding of parsed) {
      const block = renderFinding(finding, included.length)
      const candidate = [...blocks, block].join('\n\n')
      if (candidate.length > available) break
      included.push(finding)
      blocks.push(block)
    }
    return { included, blocks }
  }
  let { included, blocks } = selectFindings(false)
  const dropped = allFindings.length > included.length
  if (dropped) ({ included, blocks } = selectFindings(true))
  if (dropped) blocks.push(COUNCIL_TRUNCATION_MARKER)
  if (appendix) blocks.push(appendix)
  const text = blocks.join('\n\n')
  return {
    text,
    findings: included,
    builderAssessment: assessment,
    truncated:
      dropped || raw.length > text.length || parsed.length < allFindings.length,
  }
}

function labeledLine(text: string, label: string): string | null {
  for (const line of text.split('\n')) {
    const value = labelMatch(line, label)
    if (value !== null) return value || null
  }
  return null
}

function factualityFlags(text: string): string[] {
  const lines = text.split('\n')
  const start = lines.findIndex((line) =>
    /^\s*(?:\*\*)?FACTUALITY FLAGS(?:\*\*)?\s*:/i.test(line),
  )
  if (start < 0) return []
  const flags: string[] = []
  for (const raw of lines.slice(start + 1)) {
    if (/^\s*(?:\*\*)?FINAL RANKING(?:\*\*)?\s*:/i.test(raw)) break
    const clean = raw.trim().replace(/^[-*+]\s+/, '')
    if (!clean || /^none[.!]?$/i.test(clean)) continue
    flags.push(bounded(clean, COUNCIL_STAGE_BUDGETS.ranking.factualityFlagChars))
    if (flags.length >= COUNCIL_STAGE_BUDGETS.ranking.maxFactualityFlags) break
  }
  return flags
}

export interface NormalizedCouncilRankingText {
  text: string
  parsed: string[]
  strongestContribution: string | null
  collectiveGap: string | null
  factualityFlags: string[]
  truncated: boolean
}

export function normalizeCouncilRankingText(value: string): NormalizedCouncilRankingText {
  const raw = value.trim()
  const parsed = parseRankingFromText(raw).slice(0, 10)
  const strongest = labeledLine(raw, 'STRONGEST CONTRIBUTION')
  const gap = labeledLine(raw, 'COLLECTIVE GAP')
  const flags = factualityFlags(raw)
  const strongestContribution = strongest
    ? bounded(strongest, COUNCIL_STAGE_BUDGETS.ranking.strongestChars)
    : null
  const collectiveGap = gap ? bounded(gap, COUNCIL_STAGE_BUDGETS.ranking.gapChars) : null
  const structured = strongestContribution !== null || collectiveGap !== null || flags.length > 0
  const rankingBlock = parsed.length > 0
    ? ['FINAL RANKING:', ...parsed.map((label, index) => `${index + 1}. ${label}`)].join('\n')
    : ''
  const optional: string[] = []
  const tryAdd = (block: string) => {
    const prefix = [...optional, block].join('\n')
    const candidate = [prefix, rankingBlock].filter(Boolean).join('\n\n')
    if (candidate.length <= COUNCIL_STAGE_BUDGETS.ranking.outputChars) optional.push(block)
  }
  if (strongestContribution) tryAdd(`STRONGEST CONTRIBUTION: ${strongestContribution}`)
  if (collectiveGap) tryAdd(`COLLECTIVE GAP: ${collectiveGap}`)
  if (flags.length > 0) {
    const includedFlags: string[] = []
    for (const flag of flags) {
      const block = ['FACTUALITY FLAGS:', ...[...includedFlags, flag].map((item) => `- ${item}`)].join('\n')
      const withoutPreviousFlags = optional.filter((item) => !item.startsWith('FACTUALITY FLAGS:'))
      const candidate = [...withoutPreviousFlags, block, rankingBlock].filter(Boolean).join('\n\n')
      if (candidate.length > COUNCIL_STAGE_BUDGETS.ranking.outputChars) break
      includedFlags.push(flag)
      const existing = optional.findIndex((item) => item.startsWith('FACTUALITY FLAGS:'))
      if (existing >= 0) optional[existing] = block
      else optional.push(block)
    }
  }
  const canonical = [...optional, rankingBlock].filter(Boolean).join('\n\n') || raw
  const text = parsed.length > 0
    ? canonical
    : bounded(canonical, COUNCIL_STAGE_BUDGETS.ranking.outputChars)
  return {
    text,
    parsed,
    strongestContribution,
    collectiveGap,
    factualityFlags: flags,
    truncated: raw.length > text.length || structured,
  }
}

interface MarkdownSection {
  heading: string
  body: string
}

function markdownSections(text: string): MarkdownSection[] {
  const sections: MarkdownSection[] = []
  let heading: string | null = null
  let body: string[] = []
  const flush = () => {
    if (heading !== null) sections.push({ heading, body: body.join('\n').trim() })
    body = []
  }
  for (const line of text.split('\n')) {
    const match = /^#{1,6}\s+(.+)$/.exec(line.trim())
    if (match) {
      flush()
      heading = match[1]
    } else if (heading !== null) {
      body.push(line)
    }
  }
  flush()
  return sections
}

function section(sections: readonly MarkdownSection[], name: RegExp): string | null {
  return sections.find((item) => name.test(item.heading))?.body ?? null
}

function withoutGateToken(text: string): string {
  return text
    .split('\n')
    .filter((line, index) => index > 0 || !/^(APPROVED|NEEDS[_\s-]?CLARIFICATION)$/i.test(line.trim()))
    .join('\n')
    .trim()
}

function normalizedQuestionBlocks(text: string): string | null {
  const parsed = parseSpecVerdict(text)
  const guided = parsed.clarifications
  if (guided && guided.length > 0) {
    return guided.slice(0, 3).map((item, index) => [
      `${index + 1}. QUESTION: ${bounded(item.question, 280)}`,
      `   WHY: ${bounded(item.why ?? 'Not supplied.', 220)}`,
      `   RECOMMENDED: ${bounded(item.recommendedAnswer ?? 'No default supplied.', 220)}`,
    ].join('\n')).join('\n')
  }
  if (parsed.questions.length > 0) {
    return parsed.questions
      .slice(0, 3)
      .map((question, index) => `${index + 1}. ${bounded(question, 600)}`)
      .join('\n')
  }
  return null
}

/** Fieldwise cap: required headings/tokens survive; only human prose is shortened. */
export function normalizeCouncilChairmanText(value: string, mode: CouncilMode): string {
  const raw = value.trim()
  const sections = markdownSections(raw)
  if (sections.length === 0) return bounded(raw, COUNCIL_STAGE_BUDGETS.chairman.outputChars)

  const blocks: string[] = []
  const consensus = section(sections, /consensus|disagreement/i)
  if (consensus) {
    blocks.push(`### ⚖️ Consensus & Disagreement\n${bounded(
      consensus,
      mode === 'spec' ? COUNCIL_STAGE_BUDGETS.chairman.consensusChars : 3_000,
    )}`)
  }
  const verdict = section(sections, /verdict/i)
  if (verdict) {
    const kind = mode === 'spec' ? parseSpecVerdict(raw).kind : null
    const rationale = bounded(withoutGateToken(verdict), COUNCIL_STAGE_BUDGETS.chairman.verdictChars)
    blocks.push(
      `### 🎯 Verdict\n${[kind ? kind.toUpperCase() : null, rationale].filter(Boolean).join('\n')}`,
    )
  }

  if (mode === 'spec') {
    const refined = section(sections, /refined spec/i)
    if (refined) {
      blocks.push(
        `### 📋 Refined Spec\n${bounded(
          refined,
          COUNCIL_STAGE_BUDGETS.chairman.refinedSpecChars,
        )}`,
      )
    }
    const questions = normalizedQuestionBlocks(raw) ?? section(sections, /questions?/i)
    if (questions) {
      blocks.push(
        `### ❓ Questions for the author\n${bounded(
          questions,
          COUNCIL_STAGE_BUDGETS.chairman.questionsChars,
        )}`,
      )
    }
  } else {
    const next = section(sections, /next step/i)
    if (next) {
      blocks.push(
        `### ➡️ Next step\n${bounded(next, COUNCIL_STAGE_BUDGETS.chairman.nextStepChars)}`,
      )
    }
  }

  if (blocks.length === 0) return bounded(raw, COUNCIL_STAGE_BUDGETS.chairman.outputChars)
  return bounded(blocks.join('\n\n'), COUNCIL_STAGE_BUDGETS.chairman.outputChars)
}

/** Visible cap for dynamic prompt material (spec, memory, question, evidence). */
export function capCouncilPromptMaterial(value: string, cap: number): string {
  return bounded(value, cap)
}
