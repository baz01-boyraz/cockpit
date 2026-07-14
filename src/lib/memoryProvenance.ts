import type { LedgerEntry } from '@shared/memory-ledger'

export type MemorySourceKind = 'claude' | 'codex' | 'cockpit' | 'manual' | 'legacy'

export interface MemorySource {
  kind: MemorySourceKind
  label: string
  /** Exact immutable ledger value. Kept intact for tooltips and audits. */
  sourceId: string | null
  /** Provider prefix removed for the compact, human-readable UI. */
  sessionId: string | null
}

export interface MemoryProvenanceSummary {
  created: MemorySource | null
  latest: MemorySource | null
}

const PROVIDER_SOURCE = /^(claude|codex):(.+)$/i

/** Decode only provider-qualified ids. Unknown ids stay explicitly legacy. */
export function memorySourceFromId(sourceId: string | null | undefined): MemorySource | null {
  if (!sourceId) return null
  const match = PROVIDER_SOURCE.exec(sourceId)
  if (match) {
    const kind = match[1].toLowerCase() as 'claude' | 'codex'
    return {
      kind,
      label: kind === 'claude' ? 'Claude' : 'Codex',
      sourceId,
      sessionId: match[2],
    }
  }
  return {
    kind: 'legacy',
    label: 'Legacy source',
    sourceId,
    sessionId: sourceId,
  }
}

/** Resolve one ledger mutation without ever guessing Claude versus Codex. */
export function memorySourceForEntry(entry: LedgerEntry): MemorySource {
  if (entry.gate === 'manual') {
    return { kind: 'manual', label: 'You', sourceId: entry.sourceId, sessionId: null }
  }

  const qualified = memorySourceFromId(entry.sourceId)
  if (qualified?.kind === 'claude' || qualified?.kind === 'codex') return qualified

  if (entry.gate === 'consolidation' || entry.gate === 'delegated' || !entry.sourceId) {
    return {
      kind: 'cockpit',
      label: 'Cockpit',
      sourceId: entry.sourceId,
      sessionId: entry.sourceId,
    }
  }

  return qualified ?? {
    kind: 'legacy',
    label: 'Legacy source',
    sourceId: entry.sourceId,
    sessionId: entry.sourceId,
  }
}

/**
 * History may arrive in either order. Creation means the oldest ledgered
 * `create`; note frontmatter is used only when old notes predate the ledger.
 */
export function summarizeMemoryProvenance(
  history: readonly LedgerEntry[],
  fallbackSourceId: string | null | undefined,
): MemoryProvenanceSummary {
  const chronological = [...history].sort(
    (a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt),
  )
  const creation = chronological.find((entry) => entry.action === 'create')
  const fallback = memorySourceFromId(fallbackSourceId)
  const created = creation ? memorySourceForEntry(creation) : fallback
  const latestEntry = chronological.at(-1)

  return {
    created,
    latest: latestEntry ? memorySourceForEntry(latestEntry) : created,
  }
}

export function memorySourceDetail(source: MemorySource): string | null {
  return source.sessionId ?? source.sourceId
}

export function shortMemorySourceDetail(source: MemorySource, cap = 30): string | null {
  const detail = memorySourceDetail(source)
  if (!detail || detail.length <= cap) return detail
  const head = Math.max(8, Math.floor((cap - 1) * 0.6))
  const tail = Math.max(6, cap - head - 1)
  return `${detail.slice(0, head)}…${detail.slice(-tail)}`
}
