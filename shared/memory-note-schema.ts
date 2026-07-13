/**
 * Memory-note frontmatter — the structural contract for every note the brain
 * writes (memory-imp G3/G6). Pure, runtime-dependency-free (zod only, which the
 * browser mock already ships).
 *
 * A note is markdown. The brain's own notes carry a small, FLAT frontmatter
 * block we fully control (no nested YAML, no array syntax — tags are a single
 * comma line) so the parser is trivial and cannot mis-read a human's markdown.
 * Human-authored notes have NO frontmatter and stay perfectly valid: parsing
 * tolerates its absence, and validation never rejects a note for lacking it.
 *
 *   ---
 *   schema: 1
 *   name: some-slug
 *   title: Some Title
 *   class: decision
 *   session: 7f3a…            (optional — the source session id)
 *   capturedAt: 2026-07-04T…  (optional — when the fact was captured)
 *   gate: save                (save = model auto-saved · asked = Baz approved)
 *   updatedAt: 2026-07-04T…
 *   tags: infra, ipc          (optional, comma-separated)
 *   ---
 *   <body — the fact itself>
 */
import { z } from 'zod'
import { normalizeNoteName } from './wikilink'

export const MEMORY_NOTE_SCHEMA_VERSION = 2

/** The classes the distiller may assign. Kept small and stable on purpose. */
export const NOTE_CLASSES = [
  'decision',
  'gotcha',
  'user',
  'reference',
  'architecture',
] as const
export type NoteClass = (typeof NOTE_CLASSES)[number]

/** How a note entered the brain. */
export const NOTE_GATES = ['save', 'asked', 'manual', 'consolidation'] as const
export type NoteGate = (typeof NOTE_GATES)[number]

export const NOTE_STATUSES = ['active', 'superseded', 'archived'] as const
export type NoteStatus = (typeof NOTE_STATUSES)[number]

export const NOTE_AUTHORITIES = [
  'human-directive',
  'code-verified',
  'source-authority',
  'equivalent-content',
  'observed',
  'model-inference',
  'legacy',
] as const
export type NoteAuthority = (typeof NOTE_AUTHORITIES)[number]

export const NOTE_SCOPES = ['project', 'global'] as const
export type NoteScope = (typeof NOTE_SCOPES)[number]

export const NOTE_CONFIDENCE = ['high', 'medium', 'low'] as const
export type NoteConfidence = (typeof NOTE_CONFIDENCE)[number]

const isoString = z
  .string()
  .refine((s) => !Number.isNaN(Date.parse(s)), { message: 'not an ISO timestamp' })

export const noteFrontmatterSchema = z.object({
  schema: z.number().int().positive(),
  name: z.string().refine((s) => normalizeNoteName(s) !== null, {
    message: 'name is not a valid slug',
  }),
  title: z.string().min(1).max(200),
  class: z.enum(NOTE_CLASSES),
  session: z.string().min(1).optional(),
  capturedAt: isoString.optional(),
  gate: z.enum(NOTE_GATES),
  updatedAt: isoString,
  tags: z.array(z.string().min(1)).default([]),
  status: z.enum(NOTE_STATUSES).optional(),
  authority: z.enum(NOTE_AUTHORITIES).optional(),
  authorityRef: z.string().min(1).max(500).optional(),
  scope: z.enum(NOTE_SCOPES).optional(),
  confidence: z.enum(NOTE_CONFIDENCE).optional(),
  firstSeenAt: isoString.optional(),
  lastVerifiedAt: isoString.optional(),
  reviewAfter: isoString.optional(),
  supersedes: z.array(z.string().min(1)).optional(),
}).superRefine((value, ctx) => {
  if (value.schema < 2) return
  for (const key of [
    'status',
    'authority',
    'scope',
    'confidence',
    'firstSeenAt',
    'reviewAfter',
  ] as const) {
    if (value[key] === undefined) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: [key], message: `${key} is required in schema v2` })
    }
  }
})

export type NoteFrontmatter = z.infer<typeof noteFrontmatterSchema>

export interface ParsedNote {
  /** Present only when a valid frontmatter block led the file. */
  frontmatter: NoteFrontmatter | null
  /** Everything after the frontmatter block (or the whole file when absent). */
  body: string
}

export interface NoteLifecycle {
  status: NoteStatus
  authority: NoteAuthority
  authorityRef: string | null
  scope: NoteScope
  confidence: NoteConfidence
  firstSeenAt: string | null
  lastVerifiedAt: string | null
  reviewAfter: string | null
  supersedes: string[]
}

/** Normalize legacy/plain notes without rewriting them on read. */
export function noteLifecycle(frontmatter: NoteFrontmatter | null): NoteLifecycle {
  return {
    status: frontmatter?.status ?? 'active',
    authority: frontmatter?.authority ?? 'legacy',
    authorityRef: frontmatter?.authorityRef ?? null,
    scope: frontmatter?.scope ?? 'project',
    confidence: frontmatter?.confidence ?? 'low',
    firstSeenAt: frontmatter?.firstSeenAt ?? frontmatter?.capturedAt ?? null,
    lastVerifiedAt: frontmatter?.lastVerifiedAt ?? null,
    reviewAfter: frontmatter?.reviewAfter ?? null,
    supersedes: frontmatter?.supersedes ?? [],
  }
}

export function isActiveNote(content: string): boolean {
  return noteLifecycle(parseNote(content).frontmatter).status === 'active'
}

// Matches the leading `---` block and swallows the single blank line
// serializeNote emits between the block and the body, so a round-trip is exact.
const FRONTMATTER_RE = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*\r?\n(?:[ \t]*\r?\n)?/

/**
 * Parse the leading frontmatter block, if it is present AND well-formed. A file
 * that opens with `---` but whose block fails the schema is treated as a plain
 * human note (frontmatter: null) — we never throw on read, and never silently
 * drop the human's content.
 */
export function parseNote(content: string): ParsedNote {
  const m = FRONTMATTER_RE.exec(content)
  if (!m) return { frontmatter: null, body: content }

  const raw = parseFlatBlock(m[1])
  if (!raw) return { frontmatter: null, body: content }

  const parsed = noteFrontmatterSchema.safeParse(raw)
  if (!parsed.success) return { frontmatter: null, body: content }

  return { frontmatter: parsed.data, body: content.slice(m[0].length) }
}

/** Parse the flat `key: value` block into a raw object (before zod coercion). */
function parseFlatBlock(block: string): Record<string, unknown> | null {
  const out: Record<string, unknown> = {}
  for (const line of block.split(/\r?\n/)) {
    if (!line.trim()) continue
    const idx = line.indexOf(':')
    if (idx === -1) return null // not a flat key:value block — bail to "no frontmatter"
    const key = line.slice(0, idx).trim()
    const value = line.slice(idx + 1).trim()
    if (!key) return null
    switch (key) {
      case 'schema': {
        const n = Number(value)
        if (!Number.isFinite(n)) return null
        out.schema = n
        break
      }
      case 'tags':
      case 'supersedes':
        out[key] = value
          .split(',')
          .map((t) => t.trim())
          .filter(Boolean)
        break
      default:
        out[key] = value
    }
  }
  return out
}

/** Deterministic serialization — same input always yields byte-identical output. */
export function serializeNote(frontmatter: NoteFrontmatter, body: string): string {
  const lines = [
    '---',
    `schema: ${frontmatter.schema}`,
    `name: ${frontmatter.name}`,
    `title: ${frontmatter.title}`,
    `class: ${frontmatter.class}`,
  ]
  if (frontmatter.session) lines.push(`session: ${frontmatter.session}`)
  if (frontmatter.capturedAt) lines.push(`capturedAt: ${frontmatter.capturedAt}`)
  lines.push(`gate: ${frontmatter.gate}`)
  lines.push(`updatedAt: ${frontmatter.updatedAt}`)
  if (frontmatter.status) lines.push(`status: ${frontmatter.status}`)
  if (frontmatter.authority) lines.push(`authority: ${frontmatter.authority}`)
  if (frontmatter.authorityRef) lines.push(`authorityRef: ${frontmatter.authorityRef}`)
  if (frontmatter.scope) lines.push(`scope: ${frontmatter.scope}`)
  if (frontmatter.confidence) lines.push(`confidence: ${frontmatter.confidence}`)
  if (frontmatter.firstSeenAt) lines.push(`firstSeenAt: ${frontmatter.firstSeenAt}`)
  if (frontmatter.lastVerifiedAt) lines.push(`lastVerifiedAt: ${frontmatter.lastVerifiedAt}`)
  if (frontmatter.reviewAfter) lines.push(`reviewAfter: ${frontmatter.reviewAfter}`)
  if (frontmatter.supersedes) lines.push(`supersedes: ${frontmatter.supersedes.join(', ')}`)
  if (frontmatter.tags.length > 0) lines.push(`tags: ${frontmatter.tags.join(', ')}`)
  lines.push('---', '')
  const trimmedBody = body.replace(/^\r?\n+/, '')
  return `${lines.join('\n')}\n${trimmedBody}`
}

export interface NoteValidation {
  ok: boolean
  errors: string[]
}

const MAX_NOTE_BYTES = 500_000

/**
 * The write-time guard (G3): a note the brain is about to persist must be
 * structurally sound. Rules:
 *  - non-empty body (a note with no fact is refused, never written),
 *  - within the size ceiling,
 *  - if a frontmatter block is present, it MUST be schema-valid AND its `name`
 *    must match the slug it is being written under (no name/file drift).
 * A human note with no frontmatter passes (only the size + non-empty checks).
 */
export function validateNoteContent(slug: string, content: string): NoteValidation {
  const errors: string[] = []
  if (content.length > MAX_NOTE_BYTES) {
    errors.push(`note exceeds ${MAX_NOTE_BYTES} bytes`)
  }

  const opensFrontmatter = /^---[ \t]*\r?\n/.test(content)
  const { frontmatter, body } = parseNote(content)

  // A file that *declares* frontmatter (opens with `---`) but fails to parse is
  // a corruption risk — refuse it rather than persist an ambiguous note.
  if (opensFrontmatter && !frontmatter) {
    errors.push('frontmatter block is present but malformed')
  }
  if (frontmatter) {
    if (frontmatter.name !== normalizeNoteName(slug)) {
      errors.push(`frontmatter name "${frontmatter.name}" does not match slug "${slug}"`)
    }
    if (frontmatter.schema > MEMORY_NOTE_SCHEMA_VERSION) {
      errors.push(`note schema ${frontmatter.schema} is newer than supported ${MEMORY_NOTE_SCHEMA_VERSION}`)
    }
    if (frontmatter.schema < 1) errors.push('note schema must be at least 1')
  }
  if (body.trim().length === 0) {
    errors.push('note body is empty')
  }
  return { ok: errors.length === 0, errors }
}
