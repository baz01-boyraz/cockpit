import type { LedgerEntry } from '@shared/memory-ledger'
import { relativeTime } from '@shared/time'
import {
  memorySourceDetail,
  memorySourceForEntry,
  shortMemorySourceDetail,
  type MemorySource,
} from '../../lib/memoryProvenance'

const ACTION_LABEL: Record<LedgerEntry['action'], string> = {
  create: 'Created',
  merge: 'Merged',
  replace: 'Updated',
  split: 'Split',
  rename: 'Renamed',
  trash: 'Moved to trash',
  restore: 'Restored',
}

function changedLabel(iso: string): string {
  const value = relativeTime(iso)
  return value === 'now' ? 'just now' : `${value} ago`
}

export function MemorySourceValue({
  source,
  compact = false,
}: {
  source: MemorySource
  compact?: boolean
}) {
  const exact = memorySourceDetail(source)
  const detail = shortMemorySourceDetail(source, compact ? 20 : 30)
  const title = exact ? `${source.label} · ${exact}` : source.label

  return (
    <strong
      className={`memsource memsource--${source.kind}`}
      title={title}
      aria-label={exact ? `${source.label}, source ${exact}` : source.label}
    >
      <span className="memsource__label">{source.label}</span>
      {detail && <span className="memsource__session mono">{detail}</span>}
    </strong>
  )
}

export function MemoryChangeHistory({
  history,
  limit = 8,
}: {
  history: readonly LedgerEntry[]
  limit?: number
}) {
  return (
    <div className="memreader__history">
      <span className="memreader__historyTitle">Change history</span>
      {history.length > 0 ? (
        <ol>
          {history.slice(0, limit).map((entry) => {
            const hash = entry.hashAfter ?? entry.hashBefore
            return (
              <li key={entry.id}>
                <span className="memreader__historyAction">
                  {ACTION_LABEL[entry.action]} · {changedLabel(entry.createdAt)}
                </span>
                <span className="memreader__historyMeta">
                  <MemorySourceValue source={memorySourceForEntry(entry)} compact />
                  <code title={hash ?? 'no content hash'}>{hash?.slice(0, 8) ?? 'no hash'}</code>
                </span>
              </li>
            )
          })}
        </ol>
      ) : (
        <p>No ledgered changes yet. Legacy file history remains in Git.</p>
      )}
    </div>
  )
}
