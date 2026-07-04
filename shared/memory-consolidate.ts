/**
 * Consolidation analysis (docs/memory-imp.md Phase 5, G5 "never write-and-forget").
 * Pure: scan the whole hub and surface what maintenance it needs — duplicate
 * notes to merge, oversized notes to split, dangling links now satisfiable. The
 * service snapshots the hub and queues these as review items; the actual fixes
 * are gated through Baz like any other change.
 */
import { textSimilarity } from './memory-reconcile'
import { MEMORY_NOTE_SCHEMA_VERSION, type NoteFrontmatter, parseNote, serializeNote } from './memory-note-schema'
import { buildLinkIndex, normalizeNoteName } from './wikilink'
import { OVERSIZE_BYTES } from './memory-health'
import { titleOf, type MemoryDoc } from './memory-hub'

export interface DuplicateFinding {
  kind: 'duplicate'
  /** The two near-identical notes (keep-slug first). */
  slugs: [string, string]
  similarity: number
}

export interface OversizeFinding {
  kind: 'oversized'
  slug: string
  bytes: number
}

export interface DanglingFinding {
  kind: 'dangling'
  /** A wanted link target with no note, and the notes that reference it. */
  target: string
  wantedBy: string[]
}

export type ConsolidationFinding = DuplicateFinding | OversizeFinding | DanglingFinding

export interface ConsolidationReport {
  duplicates: DuplicateFinding[]
  oversized: OversizeFinding[]
  dangling: DanglingFinding[]
}

/** What a consolidation pass produced (returned over IPC to the brain UI). */
export interface ConsolidationResult {
  report: ConsolidationReport
  /** Merge proposals queued for Baz to approve. */
  queued: number
  /** The pre-pass snapshot id — a bad clean-up is one restore away (G7). */
  snapshotId: string
}

const utf8Bytes = (s: string): number => new TextEncoder().encode(s).length
const bodyOf = (content: string): string => parseNote(content).body

/**
 * Analyze the hub for maintenance work. Deterministic; does not mutate. A note
 * appears in at most one duplicate pair (the strongest), so the report is a
 * clean, non-overlapping worklist.
 */
export function analyzeConsolidation(
  docs: MemoryDoc[],
  opts: { duplicateSimilarity?: number; oversizeBytes?: number } = {},
): ConsolidationReport {
  const dupThreshold = opts.duplicateSimilarity ?? 0.72
  const oversizeBytes = opts.oversizeBytes ?? OVERSIZE_BYTES

  const named = docs
    .map((d) => ({ slug: normalizeNoteName(d.name), doc: d }))
    .filter((x): x is { slug: string; doc: MemoryDoc } => x.slug !== null)

  // Duplicate pairs — greedy strongest-first, each note used once.
  const pairs: DuplicateFinding[] = []
  const used = new Set<string>()
  const scored: { a: string; b: string; sim: number }[] = []
  for (let i = 0; i < named.length; i += 1) {
    for (let j = i + 1; j < named.length; j += 1) {
      const sim = textSimilarity(bodyOf(named[i].doc.content), bodyOf(named[j].doc.content))
      if (sim >= dupThreshold) scored.push({ a: named[i].slug, b: named[j].slug, sim })
    }
  }
  scored.sort((x, y) => y.sim - x.sim)
  for (const s of scored) {
    if (used.has(s.a) || used.has(s.b)) continue
    used.add(s.a)
    used.add(s.b)
    pairs.push({ kind: 'duplicate', slugs: [s.a, s.b], similarity: s.sim })
  }

  const oversized: OversizeFinding[] = named
    .map(({ slug, doc }) => ({ slug, bytes: utf8Bytes(doc.content) }))
    .filter((x) => x.bytes > oversizeBytes)
    .map((x) => ({ kind: 'oversized' as const, slug: x.slug, bytes: x.bytes }))

  const idx = buildLinkIndex(docs)
  const dangling: DanglingFinding[] = [...idx.unresolved.entries()].map(([target, wantedBy]) => ({
    kind: 'dangling' as const,
    target,
    wantedBy: [...wantedBy],
  }))

  return { duplicates: pairs, oversized, dangling }
}

/**
 * Merge a duplicate `drop` note into `keep`, preserving the keep note's
 * frontmatter and appending the drop's body under a provenance comment. The
 * result is a valid note under `keepSlug`; the caller trashes the drop note.
 */
export function mergeDuplicate(
  keepSlug: string,
  keepContent: string,
  dropSlug: string,
  dropContent: string,
  now: string,
): string {
  const keep = parseNote(keepContent)
  const dropBody = parseNote(dropContent).body.trim()
  const front: NoteFrontmatter = keep.frontmatter
    ? { ...keep.frontmatter, updatedAt: now }
    : {
        schema: MEMORY_NOTE_SCHEMA_VERSION,
        name: keepSlug,
        title: titleOf(keepContent, keepSlug),
        class: 'reference',
        gate: 'consolidation',
        updatedAt: now,
        tags: [],
      }
  const mergedBody = `${keep.body.trimEnd()}\n\n<!-- merged from ${dropSlug} on ${now.slice(0, 10)} -->\n${dropBody}\n`
  return serializeNote(front, mergedBody)
}
