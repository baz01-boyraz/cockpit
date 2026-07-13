/**
 * R0 retrieval evaluation — a deterministic, content-free scorecard over a
 * frozen synthetic corpus. This module MEASURES the current ranker; it does not
 * change retrieval behavior or inject context into any engine.
 */
import { rankNotes, type RankableNote, type RankedNote } from './memory-recall'

export const MEMORY_EVAL_SPLITS = ['tune', 'holdout'] as const
export type MemoryEvalSplit = (typeof MEMORY_EVAL_SPLITS)[number]

export const MEMORY_EVAL_LANGUAGES = ['en', 'tr'] as const
export type MemoryEvalLanguage = (typeof MEMORY_EVAL_LANGUAGES)[number]

export const MEMORY_EVAL_CATEGORIES = ['positive', 'semantic', 'lifecycle', 'no_match'] as const
export type MemoryEvalCategory = (typeof MEMORY_EVAL_CATEGORIES)[number]

export const MEMORY_EVAL_SEVERITIES = ['critical', 'high', 'medium', 'low'] as const
export type MemoryEvalSeverity = (typeof MEMORY_EVAL_SEVERITIES)[number]

export interface MemoryEvalNote extends RankableNote {
  status: string
  eligible: boolean
}

export interface MemoryEvalCase {
  id: string
  split: MemoryEvalSplit
  language: MemoryEvalLanguage
  category: MemoryEvalCategory
  severity: MemoryEvalSeverity
  query: string
  expectedTop3: string[]
  forbiddenNotes: string[]
  expectNoMatch?: boolean
}

export interface MemoryEvalCorpus {
  schemaVersion: number
  sourceKind: 'synthetic' | 'local-redacted'
  notes: MemoryEvalNote[]
  cases: MemoryEvalCase[]
}

export interface MemoryEvalUnsafeSelection {
  caseId: string
  note: string
  status: string
  rank: number
}

export interface MemoryEvalMiss {
  caseId: string
  expectedTop3: string[]
  returned: string[]
  severity: MemoryEvalSeverity
}

export interface MemoryEvalCaseResult {
  id: string
  split: MemoryEvalSplit
  language: MemoryEvalLanguage
  category: MemoryEvalCategory
  severity: MemoryEvalSeverity
  returned: string[]
  top1Hit: boolean
  top3Hit: boolean
  falseInjection: boolean
}

export interface MemoryEvalReport {
  schemaVersion: 1
  sourceKind: MemoryEvalCorpus['sourceKind']
  caseCount: number
  positiveCases: number
  noMatchCases: number
  top1Hits: number
  top3Hits: number
  top1HitRate: number
  top3HitRate: number
  severityWeightedTop3Rate: number
  noMatchFalseInjections: number
  unsafeSelections: MemoryEvalUnsafeSelection[]
  misses: MemoryEvalMiss[]
  splits: Record<MemoryEvalSplit, number>
  languages: Record<MemoryEvalLanguage, number>
  categories: Record<MemoryEvalCategory, number>
  cases: MemoryEvalCaseResult[]
}

export type MemoryEvalRanker = (
  query: string,
  notes: readonly RankableNote[],
  limit: number,
) => RankedNote[]

const severityWeight: Record<MemoryEvalSeverity, number> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
}

const rate = (numerator: number, denominator: number): number =>
  denominator === 0 ? 0 : Number((numerator / denominator).toFixed(4))

/** Validate fixture integrity without throwing, so a bad corpus is actionable. */
export function validateMemoryEvalCorpus(corpus: MemoryEvalCorpus): string[] {
  const errors: string[] = []
  if (corpus.schemaVersion !== 1) errors.push('schemaVersion must be 1')
  if (corpus.sourceKind !== 'synthetic' && corpus.sourceKind !== 'local-redacted') {
    errors.push('sourceKind must be synthetic or local-redacted')
  }
  const notes = Array.isArray(corpus.notes) ? corpus.notes : []
  const cases = Array.isArray(corpus.cases) ? corpus.cases : []
  if (notes.length === 0) errors.push('notes must not be empty')
  if (cases.length === 0) errors.push('cases must not be empty')

  const noteNames = new Set<string>()
  for (const note of notes) {
    if (!note.name?.trim()) errors.push('every note needs a name')
    if (noteNames.has(note.name)) errors.push(`duplicate note: ${note.name}`)
    noteNames.add(note.name)
    if (note.hook != null && typeof note.hook !== 'string') errors.push(`note ${note.name} has invalid hook`)
    if (typeof note.status !== 'string' || !note.status.trim()) errors.push(`note ${note.name} needs status`)
    if (typeof note.eligible !== 'boolean') errors.push(`note ${note.name} needs eligible:boolean`)
  }

  const caseIds = new Set<string>()
  for (const item of cases) {
    if (!item.id?.trim()) errors.push('every case needs an id')
    if (caseIds.has(item.id)) errors.push(`duplicate case: ${item.id}`)
    caseIds.add(item.id)
    if (!MEMORY_EVAL_SPLITS.includes(item.split)) errors.push(`invalid split: ${item.id}`)
    if (!MEMORY_EVAL_LANGUAGES.includes(item.language)) errors.push(`invalid language: ${item.id}`)
    if (!MEMORY_EVAL_CATEGORIES.includes(item.category)) errors.push(`invalid category: ${item.id}`)
    if (!MEMORY_EVAL_SEVERITIES.includes(item.severity)) errors.push(`invalid severity: ${item.id}`)
    if (!item.query?.trim()) errors.push(`empty query: ${item.id}`)
    const expectedTop3 = Array.isArray(item.expectedTop3) ? item.expectedTop3 : []
    const forbiddenNotes = Array.isArray(item.forbiddenNotes) ? item.forbiddenNotes : []
    if (!Array.isArray(item.expectedTop3)) errors.push(`expectedTop3 must be an array: ${item.id}`)
    if (!Array.isArray(item.forbiddenNotes)) errors.push(`forbiddenNotes must be an array: ${item.id}`)
    if (item.expectNoMatch && expectedTop3.length > 0) {
      errors.push(`no-match case ${item.id} cannot have expectedTop3`)
    }
    if (!item.expectNoMatch && expectedTop3.length === 0) {
      errors.push(`non-no-match case ${item.id} needs expectedTop3`)
    }
    for (const name of [...expectedTop3, ...forbiddenNotes]) {
      if (!noteNames.has(name)) errors.push(`unknown note ${name} in case ${item.id}`)
    }
  }
  return errors
}

/**
 * Evaluate top-3 relevance + no-match safety + lifecycle safety. Returned data
 * contains ids/note names only — never query text or hooks — so reports are safe
 * to persist as diagnostics.
 */
export function evaluateMemoryRetrievalCorpus(
  corpus: MemoryEvalCorpus,
  ranker: MemoryEvalRanker = rankNotes,
): MemoryEvalReport {
  const errors = validateMemoryEvalCorpus(corpus)
  if (errors.length > 0) throw new Error(`Invalid memory eval corpus: ${errors.join('; ')}`)

  const notes = corpus.notes.map(({ name, hook, status, eligible }) => ({
    name,
    hook,
    status,
    eligible,
  }))
  const noteMeta = new Map(corpus.notes.map((note) => [note.name, note]))
  const unsafeSelections: MemoryEvalUnsafeSelection[] = []
  const misses: MemoryEvalMiss[] = []
  const cases: MemoryEvalCaseResult[] = []
  let positiveCases = 0
  let noMatchCases = 0
  let top1Hits = 0
  let top3Hits = 0
  let noMatchFalseInjections = 0
  let weightedPossible = 0
  let weightedMatched = 0

  const ordered = [...corpus.cases].sort((a, b) => a.id.localeCompare(b.id))
  for (const item of ordered) {
    const returned = ranker(item.query, notes, 3).map((note) => note.name)
    const expected = new Set(item.expectedTop3)
    const top1Hit = returned.length > 0 && expected.has(returned[0])
    const top3Hit = returned.some((name) => expected.has(name))
    const falseInjection = !!item.expectNoMatch && returned.length > 0

    if (item.expectNoMatch) {
      noMatchCases += 1
      if (falseInjection) noMatchFalseInjections += 1
    } else if (item.expectedTop3.length > 0) {
      positiveCases += 1
      const weight = severityWeight[item.severity]
      weightedPossible += weight
      if (top1Hit) top1Hits += 1
      if (top3Hit) {
        top3Hits += 1
        weightedMatched += weight
      } else {
        misses.push({
          caseId: item.id,
          expectedTop3: [...item.expectedTop3],
          returned,
          severity: item.severity,
        })
      }
    }

    const forbidden = new Set(item.forbiddenNotes)
    returned.forEach((name, index) => {
      const meta = noteMeta.get(name)
      if (!meta) return
      if (!meta.eligible || forbidden.has(name)) {
        unsafeSelections.push({ caseId: item.id, note: name, status: meta.status, rank: index + 1 })
      }
    })

    cases.push({
      id: item.id,
      split: item.split,
      language: item.language,
      category: item.category,
      severity: item.severity,
      returned,
      top1Hit,
      top3Hit,
      falseInjection,
    })
  }

  const count = <T extends string>(values: readonly T[], target: T): number =>
    values.filter((value) => value === target).length
  const splits = ordered.map((item) => item.split)
  const languages = ordered.map((item) => item.language)
  const categories = ordered.map((item) => item.category)

  return {
    schemaVersion: 1,
    sourceKind: corpus.sourceKind,
    caseCount: ordered.length,
    positiveCases,
    noMatchCases,
    top1Hits,
    top3Hits,
    top1HitRate: rate(top1Hits, positiveCases),
    top3HitRate: rate(top3Hits, positiveCases),
    severityWeightedTop3Rate: rate(weightedMatched, weightedPossible),
    noMatchFalseInjections,
    unsafeSelections,
    misses,
    splits: { tune: count(splits, 'tune'), holdout: count(splits, 'holdout') },
    languages: { en: count(languages, 'en'), tr: count(languages, 'tr') },
    categories: {
      positive: count(categories, 'positive'),
      semantic: count(categories, 'semantic'),
      lifecycle: count(categories, 'lifecycle'),
      no_match: count(categories, 'no_match'),
    },
    cases,
  }
}
