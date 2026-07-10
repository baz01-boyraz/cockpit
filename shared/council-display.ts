import { extractRefinedSpec, type CouncilResult } from './council'

export type CouncilDisplayKind = 'approved' | 'clarify' | 'failed' | 'reviewed'

export interface CouncilDisplayModel {
  kind: CouncilDisplayKind
  label: string
  why: string
  questions: string[]
  refinedSpec: string | null
  goal: string | null
  acceptanceCriteria: string[]
}

export type CouncilMarkdownBlock =
  | { type: 'heading'; text: string }
  | { type: 'paragraph'; text: string }
  | { type: 'ordered-list'; items: string[] }
  | { type: 'unordered-list'; items: string[] }

const normalize = (text: string): string => text.replace(/\s+/g, ' ').trim()

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

function verdictWhy(result: CouncilResult): string {
  if (!result.ok) return result.error?.trim() || 'The council could not produce a reliable verdict.'
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

/** Convert a raw CouncilResult into the verdict-first facts the UI needs. */
export function buildCouncilDisplay(result: CouncilResult): CouncilDisplayModel {
  const kind: CouncilDisplayKind = !result.ok
    ? 'failed'
    : result.specVerdict?.kind === 'approved'
      ? 'approved'
      : result.specVerdict?.kind === 'needs_clarification'
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
  const refinedSpec = result.verdict ? extractRefinedSpec(result.verdict) : null

  return {
    kind,
    label,
    why: verdictWhy(result),
    questions: result.specVerdict?.questions ?? [],
    refinedSpec,
    goal: refinedSpec ? refinedField(refinedSpec, 'Goal') : null,
    acceptanceCriteria: acceptanceItems(
      refinedSpec ? refinedField(refinedSpec, 'Acceptance criteria') : null,
    ),
  }
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

/** Parse the small markdown subset emitted by council prompts into safe blocks. */
export function parseCouncilMarkdown(text: string): CouncilMarkdownBlock[] {
  const blocks: CouncilMarkdownBlock[] = []
  let paragraph: string[] = []
  let listType: 'ordered-list' | 'unordered-list' | null = null
  let listItems: string[] = []

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
    const heading = /^#{1,6}\s+(.+)$/.exec(line)
    const ordered = /^\d+[.)]\s+(.+)$/.exec(line)
    const unordered = /^[-*+]\s+(.+)$/.exec(line)

    if (heading) {
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
  flushParagraph()
  flushList()
  return blocks
}
