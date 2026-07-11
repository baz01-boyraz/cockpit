#!/usr/bin/env node
import { readFileSync } from 'node:fs'

const MEASUREMENT_GAPS = [
  'chairman_engine',
  'physical_attempts',
  'stage_input_characters',
  'stage_tokens',
  'rendered_duplicate_sections',
]

function rate(numerator, denominator) {
  return denominator === 0 ? 0 : Number((numerator / denominator).toFixed(4))
}

function requireArray(value, label) {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`)
  return value
}

function validateCorpus(raw) {
  if (!raw || typeof raw !== 'object') throw new Error('input must be a JSON object')
  if (raw.schemaVersion !== 1) throw new Error('schemaVersion must be 1')
  if (raw.sourceKind !== 'synthetic' && raw.sourceKind !== 'local-redacted') {
    throw new Error('sourceKind must be synthetic or local-redacted')
  }
  const cases = requireArray(raw.cases, 'cases')
  if (cases.length === 0) throw new Error('cases must not be empty')
  const ids = new Set()
  for (const item of cases) {
    if (!item?.id || typeof item.id !== 'string') throw new Error('every case needs an id')
    if (ids.has(item.id)) throw new Error(`duplicate case id: ${item.id}`)
    ids.add(item.id)
    if (!['tune', 'holdout'].includes(item.split)) throw new Error(`invalid split: ${item.id}`)
    if (!['spec', 'diff', 'analysis'].includes(item.expectedIntent)) {
      throw new Error(`invalid expectedIntent: ${item.id}`)
    }
    if (!['en', 'tr'].includes(item.language)) throw new Error(`invalid language: ${item.id}`)
    if (!['critical', 'high', 'medium', 'low'].includes(item.severity)) {
      throw new Error(`invalid severity: ${item.id}`)
    }
    requireArray(item.requiredSignals, `${item.id}.requiredSignals`)
    requireArray(item.forbiddenClaims, `${item.id}.forbiddenClaims`)
    if (raw.sourceKind === 'synthetic') {
      if (!item.result || typeof item.result !== 'object') throw new Error(`missing result: ${item.id}`)
      requireArray(item.result.seats, `${item.id}.result.seats`)
      requireArray(item.result.rankings, `${item.id}.result.rankings`)
    } else {
      for (const proseField of ['result', 'question', 'prompt', 'seatProse', 'verdictProse']) {
        if (Object.hasOwn(item, proseField)) {
          throw new Error(`local-redacted case ${item.id} must not include ${proseField}`)
        }
      }
      requireArray(item.observedSignals, `${item.id}.observedSignals`)
      requireArray(item.observedForbiddenClaims, `${item.id}.observedForbiddenClaims`)
      if (!['spec', 'diff', 'analysis'].includes(item.observedMode)) {
        throw new Error(`invalid observedMode: ${item.id}`)
      }
      const metrics = item.redactedMetrics
      if (!metrics || typeof metrics !== 'object') throw new Error(`missing redactedMetrics: ${item.id}`)
      requireArray(metrics.providers, `${item.id}.redactedMetrics.providers`)
      for (const key of [
        'seats',
        'failedSeats',
        'rankings',
        'fallbackSeats',
        'logicalCalls',
        'minimumPhysicalAttempts',
        'generatedCharacters',
        'resultBytes',
        'durationMs',
        'refinedSpecHeadingCount',
      ]) {
        if (!Number.isInteger(metrics[key]) || metrics[key] < 0) {
          throw new Error(`invalid ${item.id}.redactedMetrics.${key}`)
        }
      }
      if (typeof metrics.hasVerdict !== 'boolean') {
        throw new Error(`invalid ${item.id}.redactedMetrics.hasVerdict`)
      }
      if (metrics.minimumPhysicalAttempts < metrics.logicalCalls) {
        throw new Error(`minimumPhysicalAttempts is below logicalCalls: ${item.id}`)
      }
      if (metrics.failedSeats > metrics.seats || metrics.fallbackSeats > metrics.seats) {
        throw new Error(`seat counters are inconsistent: ${item.id}`)
      }
      const structuralCalls = metrics.seats + metrics.rankings + Number(metrics.hasVerdict)
      if (metrics.logicalCalls < structuralCalls) {
        throw new Error(`logicalCalls is below persisted stage count: ${item.id}`)
      }
      if (metrics.providers.some((provider) => typeof provider !== 'string' || !provider.trim())) {
        throw new Error(`invalid provider label: ${item.id}`)
      }
      const allowedSignals = new Set(item.requiredSignals.map((value) => String(value).toLowerCase()))
      const allowedClaims = new Set(item.forbiddenClaims.map((value) => String(value).toLowerCase()))
      for (const signal of item.observedSignals) {
        if (!allowedSignals.has(String(signal).toLowerCase())) {
          throw new Error(`unlabelled observed signal in ${item.id}`)
        }
      }
      for (const claim of item.observedForbiddenClaims) {
        if (!allowedClaims.has(String(claim).toLowerCase())) {
          throw new Error(`unlabelled observed forbidden claim in ${item.id}`)
        }
      }
    }
  }
  return raw
}

function countHeading(text, heading) {
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return (text.match(new RegExp(`^#{1,6}\\s+.*${escaped}`, 'gim')) ?? []).length
}

/** Evaluate stored/synthetic Council results without returning any seat/verdict prose. */
export function evaluateCouncilCorpus(input) {
  const corpus = validateCorpus(input)
  const ordered = [...corpus.cases].sort((a, b) => a.id.localeCompare(b.id))
  const forbiddenClaimHits = []
  const intentMismatches = []
  const verdictExpectationMismatches = []
  const cases = []
  const providers = new Set()
  let logicalCalls = 0
  let minimumPhysicalAttempts = 0
  let generatedCharacters = 0
  let resultBytes = 0
  let durationMs = 0
  let requiredTotal = 0
  let requiredMatched = 0

  for (const item of ordered) {
    const redacted = corpus.sourceKind === 'local-redacted'
    const seats = redacted ? [] : item.result.seats
    const rankings = redacted ? [] : item.result.rankings
    const verdict = redacted ? '' : typeof item.result.verdict === 'string' ? item.result.verdict : ''
    const metrics = item.redactedMetrics
    const fallbackSeats = redacted
      ? metrics.fallbackSeats
      : seats.filter((seat) => seat?.usedFallback === true).length
    const chairmanCalls = redacted ? Number(metrics.hasVerdict) : Number(!!verdict)
    const caseLogicalCalls = redacted
      ? metrics.logicalCalls
      : seats.length + rankings.length + chairmanCalls
    const caseMinimumAttempts = redacted
      ? metrics.minimumPhysicalAttempts
      : caseLogicalCalls + fallbackSeats
    const seatChars = seats.reduce((sum, seat) => sum + (typeof seat?.text === 'string' ? seat.text.length : 0), 0)
    const rankingChars = rankings.reduce(
      (sum, ranking) => sum + (typeof ranking?.text === 'string' ? ranking.text.length : 0),
      0,
    )
    const caseGeneratedCharacters = redacted
      ? metrics.generatedCharacters
      : seatChars + rankingChars + verdict.length
    const caseResultBytes = redacted
      ? metrics.resultBytes
      : Buffer.byteLength(JSON.stringify(item.result), 'utf8')
    const verdictLower = verdict.toLowerCase()
    const observedSignals = new Set(
      (redacted ? item.observedSignals : []).map((value) => String(value).toLowerCase()),
    )
    const observedClaims = new Set(
      (redacted ? item.observedForbiddenClaims : []).map((value) => String(value).toLowerCase()),
    )
    const signalMisses = []
    const signalMatches = []

    for (const signal of item.requiredSignals) {
      requiredTotal += 1
      const normalized = String(signal).toLowerCase()
      if (redacted ? observedSignals.has(normalized) : verdictLower.includes(normalized)) {
        requiredMatched += 1
        signalMatches.push(signal)
      } else {
        signalMisses.push(signal)
      }
    }
    for (const claim of item.forbiddenClaims) {
      const normalized = String(claim).toLowerCase()
      if (redacted ? observedClaims.has(normalized) : verdictLower.includes(normalized)) {
        forbiddenClaimHits.push({ caseId: item.id, claim })
      }
    }
    const observedMode = redacted ? item.observedMode : item.result.mode
    if (observedMode !== item.expectedIntent) intentMismatches.push(item.id)
    const expectedNoVerdict = item.expectNoVerdict === true
    const hasVerdict = redacted ? metrics.hasVerdict : !!verdict
    if ((expectedNoVerdict && hasVerdict) || (!expectedNoVerdict && !hasVerdict)) {
      verdictExpectationMismatches.push(item.id)
    }
    const caseProviders = redacted
      ? metrics.providers
      : seats.map((seat) => seat?.engine?.engine).filter(Boolean)
    for (const provider of caseProviders) {
      if (typeof provider === 'string' && provider) providers.add(provider)
    }

    logicalCalls += caseLogicalCalls
    minimumPhysicalAttempts += caseMinimumAttempts
    generatedCharacters += caseGeneratedCharacters
    resultBytes += caseResultBytes
    durationMs += redacted
      ? metrics.durationMs
      : Number.isFinite(item.result.stats?.durationMs) ? item.result.stats.durationMs : 0
    cases.push({
      id: item.id,
      split: item.split,
      language: item.language,
      severity: item.severity,
      expectedIntent: item.expectedIntent,
      observedMode: observedMode ?? null,
      seats: redacted ? metrics.seats : seats.length,
      failedSeats: redacted ? metrics.failedSeats : seats.filter((seat) => seat?.ok !== true).length,
      rankings: redacted ? metrics.rankings : rankings.length,
      fallbackSeats,
      logicalCalls: caseLogicalCalls,
      minimumPhysicalAttempts: caseMinimumAttempts,
      generatedCharacters: caseGeneratedCharacters,
      resultBytes: caseResultBytes,
      providerCount: new Set(caseProviders).size,
      refinedSpecHeadingCount: redacted
        ? metrics.refinedSpecHeadingCount
        : countHeading(verdict, 'Refined Spec'),
      signalMatches,
      signalMisses,
      hasVerdict,
    })
  }

  return {
    schemaVersion: 1,
    sourceKind: corpus.sourceKind,
    caseCount: ordered.length,
    splits: {
      tune: ordered.filter((item) => item.split === 'tune').length,
      holdout: ordered.filter((item) => item.split === 'holdout').length,
    },
    logicalCalls,
    minimumPhysicalAttempts,
    generatedCharacters,
    resultBytes,
    durationMs,
    providers: [...providers].sort(),
    requiredSignals: {
      matched: requiredMatched,
      total: requiredTotal,
      recall: rate(requiredMatched, requiredTotal),
    },
    forbiddenClaimHits,
    intentMismatches,
    verdictExpectationMismatches,
    measurementGaps: [...MEASUREMENT_GAPS],
    cases,
  }
}

function parseArgs(argv) {
  let input = null
  let pretty = false
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--input') input = argv[++i] ?? null
    else if (argv[i] === '--pretty') pretty = true
    else if (argv[i] === '--help') return { help: true, input: null, pretty: false }
    else throw new Error(`unknown argument: ${argv[i]}`)
  }
  if (!input) throw new Error('--input <json> is required')
  return { help: false, input, pretty }
}

function main() {
  try {
    const args = parseArgs(process.argv.slice(2))
    if (args.help) {
      process.stdout.write('Usage: node scripts/diagnostics/council-baseline.mjs --input <corpus.json> [--pretty]\n')
      return
    }
    const raw = JSON.parse(readFileSync(args.input, 'utf8'))
    const report = evaluateCouncilCorpus(raw)
    process.stdout.write(`${JSON.stringify(report, null, args.pretty ? 2 : 0)}\n`)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown error'
    process.stderr.write(`council-baseline: ${message}\n`)
    process.exitCode = 1
  }
}

if (process.argv[1]?.endsWith('council-baseline.mjs')) main()
