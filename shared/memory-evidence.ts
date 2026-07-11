/**
 * Compliance evidence for the memory-first contract.
 *
 * The contract requires an engine to open its reply with exactly one status
 * line — `MEMORY: read <note files>` or `MEMORY: no relevant notes`. This
 * detector turns that line into structured evidence. A receipt proves the
 * contract was delivered; this proves (or denies) that the engine answered
 * under it. Only the exact contract forms count — anything else is `missing`,
 * never charitably upgraded to compliance.
 */

export type MemoryEvidenceStatus = 'read' | 'none' | 'missing'

export interface MemoryEvidence {
  status: MemoryEvidenceStatus
  /** Note files the engine claims to have read (empty unless status is `read`). */
  files: string[]
}

/** How deep into the reply the status line may sit (some TUIs emit a greeting first). */
const SCAN_LINES = 5

export function detectMemoryEvidence(reply: string): MemoryEvidence {
  const lines = reply
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .slice(0, SCAN_LINES)

  for (const line of lines) {
    const match = /^MEMORY:\s*(.+)$/i.exec(line)
    if (!match) continue
    const tail = match[1].trim()
    if (/^no relevant notes\b/i.test(tail)) return { status: 'none', files: [] }
    const read = /^read\s+(.+)$/i.exec(tail)
    if (read) {
      const files = read[1]
        .split(/[,\s]+/)
        .map((token) => token.replace(/[.,;]+$/, ''))
        .filter((token) => token.length > 0)
      return { status: 'read', files }
    }
    // A MEMORY line that matches neither contract form is not evidence.
    return { status: 'missing', files: [] }
  }
  return { status: 'missing', files: [] }
}
