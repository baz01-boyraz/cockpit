/**
 * Pipeline result types (docs/memory-imp.md Phases 2.3–3.3). Pure shapes the
 * capture flow returns to the renderer — a per-observation proposal plus the
 * tallies. Used by the IPC contract and the mock.
 */
import type { GateOutcome } from './memory-commit'
import type { ReconcileDecision } from './memory-reconcile'
import type { ObservationScope } from './memory-observation'
import type { NoteClass } from './memory-note-schema'

export interface MemoryProposal {
  scope: ObservationScope
  class: NoteClass
  slug: string
  title: string
  /** What the gate decided: commit (auto-save), review (ask Baz), skip (dup). */
  gate: GateOutcome
  reconcile: ReconcileDecision
  similarity: number
  reason: string
  /** The exact note bytes a commit/review would write; null for a skip. */
  proposedContent: string | null
}

export interface CaptureResult {
  proposals: MemoryProposal[]
  committed: number
  queued: number
  skipped: number
  /** New transcript byte offset — the capture cursor to persist. */
  nextOffset: number
  /** True when nothing was written (preview only). */
  dryRun: boolean
  /** Set when distillation failed; proposals will be empty. */
  error?: string
}
