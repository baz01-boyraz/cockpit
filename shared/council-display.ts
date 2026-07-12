import {
  councilSpecVerdictKind,
  normalizeCouncilResult,
  type CouncilClarification,
  type CouncilClarificationAnswer,
  type CouncilResult,
  type NormalizedCouncilResult,
} from './council'

export type CouncilDisplayKind = 'approved' | 'clarify' | 'failed' | 'reviewed'

export interface CouncilDisplayModel {
  kind: CouncilDisplayKind
  label: string
  why: string
  questions: string[]
  clarifications: CouncilClarification[]
  refinedSpec: string | null
  chairmanAnalysis: string | null
  goal: string | null
  acceptanceCriteria: string[]
}

export type CouncilMarkdownBlock =
  | { type: 'heading'; text: string }
  | { type: 'paragraph'; text: string }
  | { type: 'ordered-list'; items: string[] }
  | { type: 'unordered-list'; items: string[] }
  | { type: 'thematic-break' }
  | { type: 'code-block'; language: string | null; code: string }

export type CouncilInlineToken =
  | { type: 'text'; text: string }
  | { type: 'strong'; text: string }
  | { type: 'emphasis'; text: string }
  | { type: 'code'; text: string }
  | { type: 'link'; text: string; href: string }

export interface CouncilPrimaryArtifact {
  kind: 'brief' | 'questions' | 'decision'
  label: string
  text: string
}

export interface CouncilReportOptions {
  title?: string
}

const normalize = (text: string): string => text.replace(/\s+/g, ' ').trim()

const INVALID_COUNCIL_RESULT: CouncilResult = {
  ok: false,
  mode: 'diff',
  seats: [],
  rankings: [],
  aggregate: [],
  labelToSeat: {},
  verdict: null,
  specVerdict: null,
  error: 'The stored Council result is invalid or unreadable.',
  stats: { seatsRun: 0, seatsFailed: 0, filesReviewed: 0, durationMs: 0 },
  sessionId: null,
}

/** Every display/export path enters through the same defensive v2/v3 adapter. */
function displayResult(value: unknown): NormalizedCouncilResult {
  return normalizeCouncilResult(value) ?? normalizeCouncilResult(INVALID_COUNCIL_RESULT)!
}

const stripInlineMarkdown = (text: string): string =>
  normalize(text.replace(/\*\*([^*]+)\*\*/g, '$1').replace(/`([^`]+)`/g, '$1'))

function firstSentence(text: string): string {
  const clean = stripInlineMarkdown(text)
  const match = /^(.+?[.!?])(?=\s|$)/.exec(clean)
  return match?.[1] ?? clean
}

function headingSection(text: string, name: RegExp): string | null {
  const lines = text.split('\n')
  const start = lines.findIndex((line) => /^#{1,6}\s+/.test(line.trim()) && name.test(line))
  if (start < 0) return null
  const body: string[] = []
  for (const raw of lines.slice(start + 1)) {
    if (/^#{1,6}\s+/.test(raw.trim())) break
    body.push(raw)
  }
  const value = body.join('\n').trim()
  return value || null
}

/** Remove one heading and its body while preserving every surrounding section. */
function withoutHeadingSection(text: string, name: RegExp): string | null {
  const lines = text.split('\n')
  const start = lines.findIndex((line) => /^#{1,6}\s+/.test(line.trim()) && name.test(line))
  if (start < 0) return text.trim() || null
  let end = lines.length
  for (let index = start + 1; index < lines.length; index += 1) {
    if (/^#{1,6}\s+/.test(lines[index].trim())) {
      end = index
      break
    }
  }
  const value = [...lines.slice(0, start), ...lines.slice(end)]
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  return value || null
}

function verdictWhy(result: NormalizedCouncilResult): string {
  if (!result.ok) return result.error?.trim() || 'The council could not produce a reliable verdict.'
  if (result.schemaVersion === 3) return result.decision.summary
  if (!result.verdict) return 'The council finished without a chairman summary.'

  const section = headingSection(result.verdict, /verdict/i)
  const source = section ?? result.verdict
  const lines = source
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !/^#{1,6}\s+/.test(line))
  if (/^(APPROVED|NEEDS[_\s-]?CLARIFICATION)$/i.test(lines[0] ?? '')) lines.shift()
  return firstSentence(lines.join(' ')) || 'The chairman returned a verdict.'
}

function refinedField(spec: string, label: string): string | null {
  const lines = spec.split('\n')
  const bold = new RegExp(`^\\*\\*${label}\\*\\*\\s*(?:—|:|-)?\\s*(.*)$`, 'i')
  const heading = new RegExp(`^#{1,6}\\s+${label}\\s*$`, 'i')
  const start = lines.findIndex((line) => bold.test(line.trim()) || heading.test(line.trim()))
  if (start < 0) return null

  const first = bold.exec(lines[start].trim())?.[1]?.trim() ?? ''
  const body = first ? [first] : []
  for (const raw of lines.slice(start + 1)) {
    const line = raw.trim()
    if (/^#{1,6}\s+/.test(line) || /^\*\*[^*]+\*\*/.test(line)) break
    if (line) body.push(line)
  }
  const value = body.join('\n').trim()
  return value || null
}

function acceptanceItems(text: string | null): string[] {
  if (!text) return []
  const numbered = text
    .split(/(?:^|\s)\d+[.)]\s+/)
    .slice(1)
    .map(stripInlineMarkdown)
    .filter(Boolean)
  if (numbered.length > 0) return numbered

  const bullets = text
    .split('\n')
    .map((line) => /^[-*+]\s+(.+)$/.exec(line.trim())?.[1] ?? null)
    .filter((item): item is string => item !== null)
    .map(stripInlineMarkdown)
  return bullets.length > 0 ? bullets : [stripInlineMarkdown(text)].filter(Boolean)
}

/** Convert any persisted v2/new v3 result into verdict-first UI facts. */
export function buildCouncilDisplay(value: unknown): CouncilDisplayModel {
  const result = displayResult(value)
  const gate = councilSpecVerdictKind(result)
  const kind: CouncilDisplayKind = !result.ok
    ? 'failed'
    : gate === 'approved'
      ? 'approved'
      : gate === 'needs_clarification'
        ? 'clarify'
        : 'reviewed'
  const label =
    kind === 'approved'
      ? 'APPROVED'
      : kind === 'clarify'
        ? 'NEEDS CLARIFICATION'
        : kind === 'failed'
          ? 'FAILED'
          : 'REVIEWED'
  const refinedSpec =
    result.mode === 'spec' && result.primaryArtifact?.kind === 'refinedSpec'
      ? result.primaryArtifact.content
      : null
  const chairmanAnalysis = result.schemaVersion === 3
    ? result.primaryArtifact?.kind === 'analysisReport' ||
      result.primaryArtifact?.kind === 'diffVerdict'
      ? result.primaryArtifact.content
      : result.evidence.rawChairman
        ? withoutHeadingSection(result.evidence.rawChairman, /refined spec/i)
        : null
    : result.verdict
      ? withoutHeadingSection(result.verdict, /refined spec/i)
      : null
  const clarifications = result.decision.questions.slice(0, 3)
  const questions = clarifications.map((item) => item.question)

  return {
    kind,
    label,
    why: verdictWhy(result),
    questions,
    clarifications,
    refinedSpec,
    chairmanAnalysis,
    goal: refinedSpec ? refinedField(refinedSpec, 'Goal') : null,
    acceptanceCriteria: acceptanceItems(
      refinedSpec ? refinedField(refinedSpec, 'Acceptance criteria') : null,
    ),
  }
}

/** The smallest useful artifact for the run's current outcome. */
export function primaryCouncilArtifact(value: unknown): CouncilPrimaryArtifact {
  const result = displayResult(value)
  const display = buildCouncilDisplay(result)
  if (display.kind === 'approved') {
    return {
      kind: 'brief',
      label: 'Copy primary brief',
      text: display.refinedSpec ?? result.verdict?.trim() ?? display.why,
    }
  }
  if (display.kind === 'clarify' && display.questions.length > 0) {
    return {
      kind: 'questions',
      label: 'Copy clarification questions',
      text: display.questions.map((question, index) => `${index + 1}. ${question}`).join('\n'),
    }
  }
  if (display.kind === 'reviewed' && result.primaryArtifact) {
    return {
      kind: 'decision',
      label:
        result.primaryArtifact.kind === 'analysisReport'
          ? 'Copy analysis report'
          : result.primaryArtifact.kind === 'diffVerdict'
            ? 'Copy diff verdict'
            : 'Copy refined spec',
      text: result.primaryArtifact.content,
    }
  }
  return {
    kind: 'decision',
    label: 'Copy decision',
    text: result.verdict?.trim() || result.error?.trim() || display.why,
  }
}

function reportEngine(engine: NormalizedCouncilResult['seats'][number]['engine']): string {
  return `${engine.engine} · ${engine.model || 'default'}`
}

function reportTitle(title?: string): string {
  const clean = title?.replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim()
  return clean ? `# Council Report — ${clean}` : '# Council Report'
}

/** Stable, DOM-independent Markdown export for one complete Council session. */
export function serializeCouncilReport(
  value: unknown,
  options: CouncilReportOptions = {},
): string {
  const result = displayResult(value)
  const display = buildCouncilDisplay(result)
  const lines = [
    reportTitle(options.title),
    '',
    `- Outcome: **${display.label}**`,
    `- Mode: \`${result.mode}\``,
    `- Session: \`${result.sessionId ?? 'not-persisted'}\``,
    `- Seats: ${result.stats.seatsRun} run, ${result.stats.seatsFailed} failed`,
    `- Files reviewed: ${result.stats.filesReviewed}`,
    `- Duration: ${result.stats.durationMs} ms`,
    '',
    '## Decision',
    '',
    display.why,
  ]

  if (display.refinedSpec) {
    lines.push('', '## Refined Spec', '', display.refinedSpec)
  }
  if (display.chairmanAnalysis) {
    lines.push('', '## Chairman Analysis', '', display.chairmanAnalysis)
  }

  lines.push('', '## Seat Perspectives')
  if (result.seats.length === 0) {
    lines.push('', '_No seat response was persisted._')
  } else {
    for (const seat of result.seats) {
      lines.push(
        '',
        `### ${seat.label}`,
        '',
        `- Status: ${seat.ok ? 'responded' : 'failed'}`,
        `- Engine: \`${reportEngine(seat.engine)}\``,
        `- Fallback: ${seat.usedFallback ? 'yes' : 'no'}`,
        '',
        seat.text.trim() || '_No response text._',
      )
    }
  }

  lines.push('', '## Peer Rankings')
  if (result.rankings.length === 0) {
    lines.push('', '_No peer ranking was persisted._')
  } else {
    result.rankings.forEach((ranking, index) => {
      lines.push('', `### Ranking ${index + 1} — ${ranking.seatId}`, '', ranking.text.trim())
    })
  }

  lines.push('', '## Aggregate Standings')
  if (result.aggregate.length === 0) {
    lines.push('', '_No aggregate standing was available._')
  } else {
    const labels = new Map(result.seats.map((seat) => [seat.id, seat.label]))
    result.aggregate.forEach((standing, index) => {
      lines.push(
        `${index + 1}. ${labels.get(standing.seatId) ?? standing.seatId} — ` +
        `average ${standing.averageRank.toFixed(2)} across ${standing.count} ranking(s)`,
      )
    })
  }

  if (result.memoryContext) {
    lines.push(
      '',
      '## Memory Context Receipt',
      '',
      `- Status: \`${result.memoryContext.status}\``,
      `- Delivery: \`${result.memoryContext.delivery}\``,
      `- Notes: ${result.memoryContext.notes.map((note) => note.name).join(', ') || 'none'}`,
    )
  }

  return `${lines.join('\n').replace(/\n{3,}/g, '\n\n').trim()}\n`
}

/** A filesystem-safe deterministic name for the Markdown export. */
export function councilReportFilename(value: unknown, fallbackId = 'session'): string {
  const result = displayResult(value)
  const source = result.sessionId ?? fallbackId
  const safe = source.toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '')
  return `council-report-${safe || 'session'}.md`
}

/**
 * Turn the author's form answers into the next spec-gate input. This stays
 * deliberately plain-text so every Council engine receives the same decisions,
 * while the service's existing untrusted-spec fence still encloses the whole
 * payload before it reaches a model.
 */
export function buildClarificationContinuation(
  originalRequest: string,
  answers: readonly CouncilClarificationAnswer[],
): string {
  const cleanAnswers = answers
    .map((item) => ({ ...item, question: item.question.trim(), answer: item.answer.trim() }))
    .filter((item) => item.question && item.answer)

  const parts = [
    '## Original request',
    originalRequest.trim(),
    '',
    '## Author clarification answers',
  ]
  cleanAnswers.forEach((item, index) => {
    parts.push(`${index + 1}. Question: ${item.question}`, `   Answer: ${item.answer}`)
  })
  parts.push(
    '',
    'These answers resolve the ambiguities above. Treat them as explicit author decisions,',
    'preserve the intent of the original request, and reassess the complete task spec.',
  )
  return parts.join('\n')
}

/** A one-sentence preview for a collapsed seat row. */
export function summarizeCouncilSeat(text: string): string {
  const meaningful = text
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line && !/^#{1,6}\s+/.test(line))
  const summary = firstSentence(meaningful ?? text)
  return summary.length <= 150 ? summary : `${summary.slice(0, 147).trimEnd()}…`
}

function pushInlineText(tokens: CouncilInlineToken[], text: string): void {
  if (!text) return
  const last = tokens.at(-1)
  if (last?.type === 'text') last.text += text
  else tokens.push({ type: 'text', text })
}

/** Parse the deliberately small, safe inline subset used by Council prose. */
export function parseCouncilInline(text: string): CouncilInlineToken[] {
  const tokens: CouncilInlineToken[] = []
  const pattern = /(\*\*[^*\n]+\*\*|`[^`\n]+`|\[[^\]\n]+\]\([^)]+\)|\*[^*\n]+\*|_[^_\n]+_)/g
  let cursor = 0
  for (const match of text.matchAll(pattern)) {
    const index = match.index ?? 0
    pushInlineText(tokens, text.slice(cursor, index))
    const raw = match[0]
    const link = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(raw)
    if (raw.startsWith('**')) tokens.push({ type: 'strong', text: raw.slice(2, -2) })
    else if (raw.startsWith('`')) tokens.push({ type: 'code', text: raw.slice(1, -1) })
    else if (link && /^(?:https?:\/\/|mailto:)/i.test(link[2])) {
      tokens.push({ type: 'link', text: link[1], href: link[2] })
    } else if (link) pushInlineText(tokens, raw)
    else tokens.push({ type: 'emphasis', text: raw.slice(1, -1) })
    cursor = index + raw.length
  }
  pushInlineText(tokens, text.slice(cursor))
  return tokens
}

/** Parse the small markdown subset emitted by council prompts into safe blocks. */
export function parseCouncilMarkdown(text: string): CouncilMarkdownBlock[] {
  const blocks: CouncilMarkdownBlock[] = []
  let paragraph: string[] = []
  let listType: 'ordered-list' | 'unordered-list' | null = null
  let listItems: string[] = []
  let fence: { language: string | null; lines: string[] } | null = null

  const flushParagraph = () => {
    if (paragraph.length === 0) return
    blocks.push({ type: 'paragraph', text: normalize(paragraph.join(' ')) })
    paragraph = []
  }
  const flushList = () => {
    if (!listType || listItems.length === 0) return
    blocks.push({ type: listType, items: listItems })
    listType = null
    listItems = []
  }

  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (fence) {
      if (/^```\s*$/.test(line)) {
        blocks.push({ type: 'code-block', language: fence.language, code: fence.lines.join('\n') })
        fence = null
      } else {
        fence.lines.push(raw)
      }
      continue
    }
    const fenceStart = /^```([a-zA-Z0-9_+-]*)\s*$/.exec(line)
    if (fenceStart) {
      flushParagraph()
      flushList()
      fence = { language: fenceStart[1] || null, lines: [] }
      continue
    }
    const heading = /^#{1,6}\s+(.+)$/.exec(line)
    const ordered = /^\d+[.)]\s+(.+)$/.exec(line)
    const unordered = /^[-*+]\s+(.+)$/.exec(line)
    const thematicBreak = /^(?:-{3,}|\*{3,}|_{3,})$/.test(line)

    if (thematicBreak) {
      flushParagraph()
      flushList()
      blocks.push({ type: 'thematic-break' })
    } else if (heading) {
      flushParagraph()
      flushList()
      blocks.push({ type: 'heading', text: heading[1] })
    } else if (ordered || unordered) {
      flushParagraph()
      const nextType = ordered ? 'ordered-list' : 'unordered-list'
      if (listType && listType !== nextType) flushList()
      listType = nextType
      listItems.push((ordered ?? unordered)![1])
    } else if (!line) {
      flushParagraph()
      flushList()
    } else {
      flushList()
      paragraph.push(line)
    }
  }
  if (fence) blocks.push({ type: 'code-block', language: fence.language, code: fence.lines.join('\n') })
  flushParagraph()
  flushList()
  return blocks
}
