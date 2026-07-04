/**
 * Turning a distilled + reconciled observation into a concrete note write
 * (docs/memory-imp.md Phase 3.3). Pure: the gate decision, and the exact bytes a
 * commit will produce. The fs write + ledger happen in the pipeline; keeping the
 * content-building here makes "what will be written" unit-testable.
 */
import {
  MEMORY_NOTE_SCHEMA_VERSION,
  type NoteFrontmatter,
  parseNote,
  serializeNote,
} from './memory-note-schema'
import { normalizeNoteName } from './wikilink'
import type { Observation } from './memory-observation'
import type { Reconciled } from './memory-reconcile'

export type GateOutcome = 'commit' | 'review' | 'skip'

/**
 * The gate (memory-imp G4): the model's own `decision` drives it, reconciliation
 * overrides only to be MORE cautious — a duplicate is skipped, a conflict is
 * always asked. Nothing questionable is committed silently.
 */
export function decideGate(obs: Observation, rec: Reconciled): GateOutcome {
  if (rec.decision === 'duplicate') return 'skip'
  if (rec.decision === 'conflict') return 'review'
  if (obs.decision === 'ask') return 'review'
  return 'commit'
}

export interface CommitOpts {
  /** ISO timestamp for updatedAt/capturedAt (passed in to stay pure). */
  now: string
  /** How the note entered — 'save' (auto) or 'asked' (human approved). */
  gate: NoteFrontmatter['gate']
  /** Source session id, recorded in frontmatter provenance. */
  sessionId?: string
}

/**
 * Tag user-scope facts with `baz` so the Phase 6 global brain can find and
 * relocate them. Until then a user-fact lives in the project hub — recorded, not
 * lost (memory-imp G2). Project facts carry no scope tag.
 */
function scopeTags(obs: Observation): string[] {
  return obs.scope === 'user' ? ['baz'] : []
}

/** The `Related: [[a]], [[b]]` footer, or '' when there are no valid links. */
function linksFooter(links: string[], selfSlug: string): string {
  const slugs = [
    ...new Set(
      links.map((l) => normalizeNoteName(l)).filter((s): s is string => !!s && s !== selfSlug),
    ),
  ]
  return slugs.length ? `\n\nRelated: ${slugs.map((s) => `[[${s}]]`).join(', ')}\n` : '\n'
}

/** Build a brand-new note's full content from an observation. */
export function buildNoteFromObservation(
  obs: Observation,
  opts: CommitOpts,
): { slug: string; content: string } {
  const slug = normalizeNoteName(obs.targetSlug)
  if (!slug) throw new Error(`Observation targetSlug is not a valid slug: ${obs.targetSlug}`)
  const frontmatter: NoteFrontmatter = {
    schema: MEMORY_NOTE_SCHEMA_VERSION,
    name: slug,
    title: obs.title,
    class: obs.class,
    session: opts.sessionId,
    capturedAt: opts.now,
    gate: opts.gate,
    updatedAt: opts.now,
    tags: scopeTags(obs),
  }
  const body = `${obs.body.trim()}${linksFooter(obs.links, slug)}`
  return { slug, content: serializeNote(frontmatter, body) }
}

/**
 * Merge an observation into an existing note: append the new fact under a dated
 * bullet and refresh `updatedAt`, preserving the human's/brain's prior content.
 * Frontmatter is created if the existing note lacked one (a human note).
 */
export function mergeObservationIntoNote(
  existingContent: string,
  obs: Observation,
  opts: CommitOpts,
): { slug: string; content: string } {
  const slug = normalizeNoteName(obs.targetSlug)
  if (!slug) throw new Error(`Observation targetSlug is not a valid slug: ${obs.targetSlug}`)
  const { frontmatter, body } = parseNote(existingContent)
  const nextFront: NoteFrontmatter = frontmatter
    ? { ...frontmatter, updatedAt: opts.now }
    : {
        schema: MEMORY_NOTE_SCHEMA_VERSION,
        name: slug,
        title: obs.title,
        class: obs.class,
        gate: opts.gate,
        updatedAt: opts.now,
        tags: [],
      }
  const addition = `\n- (${opts.now.slice(0, 10)}) ${obs.body.trim()}`
  const nextBody = `${body.trimEnd()}${addition}\n`
  return { slug, content: serializeNote(nextFront, nextBody) }
}
