/**
 * Distiller observations (docs/memory-imp.md Phase 2). Pure: the shape a single
 * distilled candidate fact takes, the model prompt that produces them, and a
 * tolerant parser for the model's JSON reply. The provider-neutral bounded
 * model call itself lives in MemoryDistiller.
 *
 * Design decisions locked 2026-07-04:
 *  - The MODEL owns the save-vs-ask judgment (`decision`), no numeric threshold.
 *  - `scope` routes the fact: 'project' → the project hub, 'user' → the global
 *    Baz brain. This is how memory becomes master of both the project and Baz.
 */
import { z } from 'zod'
import { NOTE_CLASSES } from './memory-note-schema'
import { normalizeNoteName } from './wikilink'
import type { TranscriptTurn } from './transcript'
import { MEMORY_POLICY_PROMPT } from './memory-policy'

export const OBSERVATION_SCOPES = ['project', 'user'] as const
export type ObservationScope = (typeof OBSERVATION_SCOPES)[number]

export const OBSERVATION_DECISIONS = ['save', 'ask'] as const
export type ObservationDecision = (typeof OBSERVATION_DECISIONS)[number]

export const observationSchema = z.object({
  scope: z.enum(OBSERVATION_SCOPES),
  class: z.enum(NOTE_CLASSES),
  /** Existing note to merge into, or the slug a new note should take. */
  targetSlug: z.string().refine((s) => normalizeNoteName(s) !== null, {
    message: 'targetSlug is not a valid slug',
  }),
  isNew: z.boolean(),
  title: z.string().min(1).max(200),
  body: z.string().min(1),
  links: z.array(z.string()).default([]),
  /** The model's own gate: save it, or ask Baz because it isn't sure. */
  decision: z.enum(OBSERVATION_DECISIONS),
  reason: z.string().min(1).max(500),
})

export type Observation = z.infer<typeof observationSchema>

export const distillResultSchema = z.object({
  observations: z.array(observationSchema).max(3),
})

export type DistillResult = z.infer<typeof distillResultSchema>

export interface DistillInput {
  turns: TranscriptTurn[]
  /** Slugs already in the target project hub (for merge/dup awareness). */
  projectSlugs: string[]
  /** Slugs already in the global Baz brain. */
  userSlugs: string[]
}

const PROMPT_HEADER = `You are the memory distiller for cockpiT — a coding cockpit. You read a work
session between a developer (Baz) and an AI, and you extract the FEW facts worth
remembering forever. You are the developer's second brain: precision over recall.

${MEMORY_POLICY_PROMPT}

Extract only durable, high-signal facts. GOOD: an architectural decision and its
reason, a non-obvious gotcha, a stable preference of Baz's, a hard constraint.
BAD: transient status, routine edits, anything obvious from the code, anything
that will be stale next week. If nothing is worth keeping, return an empty list.

Return at most 3 observations per capture. Combine closely related findings into
one self-contained note instead of producing a cluster of tiny incident notes.
An unresolved diagnosis, a planned fix, or a statement that work is still in
progress is transient status — omit it. For a failure-mode gotcha, the transcript
must show the verified outcome: what failed, why, what replaced it, and how the
replacement was checked. A diagnosis without a verified correction is not Memory.

Also surface a failure-mode observation when the session shows a clear
mistake-then-correction pattern — an approach was tried, did NOT work, and a
different approach was then used to fix it. Capture what failed, why it failed,
and what worked instead, as a "gotcha". This is an ADDITION to what counts as
worth keeping, not a lowering of the bar: still precision over recall, still an
empty list when nothing durable is present. A one-off typo that was immediately
fixed is not a durable failure; a wrong assumption or a dead-end approach that
would trip someone up again is.

For each fact decide two things yourself:
  scope    — "project" if it is about THIS project; "user" if it is about Baz
             (a preference, a working style, a standing decision that travels
             across projects).
  decision — "save" if you are confident it matters and is unambiguous; "ask"
             ONLY for a genuinely ambiguous, high-impact conflict with an
             existing user rule, architectural decision, or protected fact.
             Mere low confidence is not review work: omit that candidate.
             Never invent facts to fill the list.

Prefer merging into an existing note (isNew=false, targetSlug=that note) over
creating near-duplicates. Choose a short kebab-case targetSlug for new notes.
"links" are slugs of related notes to cross-reference.

Reply with STRICT JSON only, no prose, no code fence:
{"observations":[{"scope":"project|user","class":"decision|gotcha|user|reference|architecture","targetSlug":"kebab-slug","isNew":true,"title":"...","body":"the fact, concrete and self-contained","links":["slug"],"decision":"save|ask","reason":"one line"}]}`

/** Build the full distiller prompt (pure — the model call is elsewhere). */
export function buildDistillPrompt(input: DistillInput): string {
  const projectSlugs = input.projectSlugs.length
    ? input.projectSlugs.join(', ')
    : '(none yet)'
  const userSlugs = input.userSlugs.length ? input.userSlugs.join(', ') : '(none yet)'
  const convo = input.turns
    .map((t) => `${t.role === 'user' ? 'DEV' : 'AI'}: ${t.text}`)
    .join('\n\n')
  return [
    PROMPT_HEADER,
    '',
    `Existing project notes: ${projectSlugs}`,
    `Existing Baz (user) notes: ${userSlugs}`,
    '',
    '--- SESSION TRANSCRIPT (secrets already redacted) ---',
    convo,
    '--- END TRANSCRIPT ---',
  ].join('\n')
}

export interface ParseObservationsResult {
  ok: boolean
  observations: Observation[]
  error?: string
}

/**
 * Parse the model's reply into validated observations. Tolerant of a leading/
 * trailing code fence or stray prose around the JSON object; strict about the
 * schema once the JSON is isolated. Never throws.
 */
export function parseObservations(raw: string): ParseObservationsResult {
  const json = isolateJsonObject(raw)
  if (json === null) {
    return { ok: false, observations: [], error: 'no JSON object found in reply' }
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch (err) {
    return { ok: false, observations: [], error: `invalid JSON: ${(err as Error).message}` }
  }
  const result = distillResultSchema.safeParse(parsed)
  if (!result.success) {
    return { ok: false, observations: [], error: result.error.issues[0]?.message ?? 'schema mismatch' }
  }
  return { ok: true, observations: result.data.observations }
}

/** Extract the outermost `{ … }` object from a possibly fenced/noisy reply. */
function isolateJsonObject(raw: string): string | null {
  const start = raw.indexOf('{')
  const end = raw.lastIndexOf('}')
  if (start === -1 || end === -1 || end < start) return null
  return raw.slice(start, end + 1)
}
