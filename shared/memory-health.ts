/**
 * Memory-brain health (docs/memory-imp.md, G6) — pure assembly over the hub's
 * docs. Health must be *visible*, never silently degrading, so this is computed
 * on demand from the same docs the snapshot/graph use and shared by the real
 * service and the browser mock.
 */
import { buildLinkIndex, normalizeNoteName } from './wikilink'
import type { MemoryDoc } from './memory-hub'

export interface MemoryHealth {
  noteCount: number
  /** Notes with no links in and none out — disconnected from the graph. */
  orphanCount: number
  /** Distinct `[[targets]]` that no note satisfies yet. */
  unresolvedCount: number
  /** Notes past the soft size ceiling — candidates for a split. */
  oversizedCount: number
  totalBytes: number
}

/** Soft ceiling above which a note is flagged for splitting (not rejected). */
export const OVERSIZE_BYTES = 8_000

/** Browser- and Node-safe UTF-8 byte length (shared runs in both). */
const utf8Bytes = (s: string): number => new TextEncoder().encode(s).length

export function assembleHealth(
  docs: MemoryDoc[],
  opts: { oversizeBytes?: number } = {},
): MemoryHealth {
  const oversizeBytes = opts.oversizeBytes ?? OVERSIZE_BYTES
  const idx = buildLinkIndex(docs)

  let orphanCount = 0
  let oversizedCount = 0
  let totalBytes = 0

  for (const doc of docs) {
    const slug = normalizeNoteName(doc.name)
    if (!slug) continue
    const linksOut = idx.forward.get(slug)?.size ?? 0
    const backlinks = idx.backlinks.get(slug)?.size ?? 0
    if (linksOut === 0 && backlinks === 0) orphanCount += 1
    const bytes = utf8Bytes(doc.content)
    totalBytes += bytes
    if (bytes > oversizeBytes) oversizedCount += 1
  }

  return {
    noteCount: docs.filter((d) => normalizeNoteName(d.name) !== null).length,
    orphanCount,
    unresolvedCount: idx.unresolved.size,
    oversizedCount,
    totalBytes,
  }
}
