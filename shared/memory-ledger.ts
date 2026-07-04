/**
 * Memory ledger domain types + brain addressing (docs/memory-imp.md, G7).
 * Pure and runtime-dependency-free — the hashing/persistence lives in the main
 * process (MemoryLedgerService); this file is only the shared vocabulary.
 */

/** Every distinct change the brain can record against a note. */
export const LEDGER_ACTIONS = [
  'create',
  'merge',
  'split',
  'rename',
  'trash',
  'restore',
] as const
export type LedgerAction = (typeof LEDGER_ACTIONS)[number]

/** How the change entered the brain. */
export const LEDGER_GATES = ['save', 'asked', 'manual', 'consolidation'] as const
export type LedgerGate = (typeof LEDGER_GATES)[number]

export interface LedgerEntry {
  id: string
  /** 'project:<projectId>' or 'baz-global'. */
  brain: string
  noteSlug: string
  action: LedgerAction
  gate: LedgerGate
  /** The capture-queue id (or other origin) this change came from, if any. */
  sourceId: string | null
  hashBefore: string | null
  hashAfter: string | null
  createdAt: string
}

export const BAZ_GLOBAL_BRAIN = 'baz-global'

/** Canonical brain key for a project's hub. */
export function projectBrain(projectId: string): string {
  return `project:${projectId}`
}
