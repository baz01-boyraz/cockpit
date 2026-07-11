import type { MemoryContextReceipt } from '@shared/memory-context'
import { memoryBadge } from '../lib/memoryBadge'

/** Per-reply memory-contract evidence chip shared by the chat surfaces. */
export function MemoryBadge({ receipt }: { receipt?: MemoryContextReceipt }) {
  const badge = memoryBadge(receipt)
  if (!badge) return null
  return (
    <span
      className={`membadge membadge--${badge.tone}`}
      title="Memory-first contract evidence for this reply"
    >
      {badge.label}
    </span>
  )
}
