import type { MemoryContextReceipt } from '@shared/memory-context'

/**
 * Maps a memory receipt (+ post-hoc evidence) to the small chat badge. The
 * badge never overstates: `ok` only when the engine proved a read with its
 * MEMORY: status line; ignoring the contract is surfaced, not hidden.
 */
export interface MemoryBadgeSpec {
  label: string
  tone: 'ok' | 'dim' | 'warn'
}

export function memoryBadge(receipt: MemoryContextReceipt | undefined): MemoryBadgeSpec | null {
  if (!receipt) return null
  if (receipt.status === 'unavailable') return { label: 'memory unavailable', tone: 'warn' }
  const evidence = receipt.evidence
  if (evidence) {
    if (evidence.status === 'read') {
      const count = evidence.files.length
      return {
        label: count > 0 ? `memory · read ${count} note${count === 1 ? '' : 's'}` : 'memory · read',
        tone: 'ok',
      }
    }
    if (evidence.status === 'none') return { label: 'memory · no relevant notes', tone: 'dim' }
    return { label: 'memory · contract ignored', tone: 'warn' }
  }
  if (receipt.status === 'empty') return { label: 'memory · no match', tone: 'dim' }
  return null
}
