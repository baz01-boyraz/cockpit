import type { BoardColumn, KanbanCard } from '@shared/kanban'
import { proposedSwarmCardPayloadSchema } from '@shared/schemas'
import type { CockpitEvents } from '../../events'
import type { ApprovalService } from '../ApprovalService'
import type { SwarmService } from '../SwarmService'

const ACTION = 'propose_open_swarm_card' as const

type LogError = (context: string, err: unknown) => void

const defaultLogError: LogError = (context, err) => {
  // Hermes stewardship is optional; a failure here must never crash the app.
  console.error(`[HermesApprovalExecutor] ${context}:`, err)
}

export interface HermesApprovalExecutorDeps {
  events: Pick<CockpitEvents, 'onTyped'>
  // `consume` is the single-use gate; `listApproved`/`get` are the read side.
  approvals: Pick<ApprovalService, 'listApproved' | 'consume' | 'get'>
  swarm: Pick<SwarmService, 'createCard' | 'updateCard' | 'startCard' | 'board'>
  logError?: LogError
}

/**
 * Watches for `propose_open_swarm_card` approvals the human accepts on the
 * Dashboard and, for each, opens+starts the Swarm card Hermes proposed.
 *
 * Why a watcher: `propose_swarm_card` (the Hermes tool) only ever RECORDS an
 * approval — it never opens a card. Approving on the Dashboard just flips the
 * request to `approved`; nothing re-issues a "start it" call the way the other
 * gated actions are re-issued by a human. So this watcher closes that gap: it
 * subscribes to `approvals:changed` and executes the proposal on approval.
 *
 * Double-execution safety: `consume()` atomically flips `approved -> consumed`
 * (its UPDATE is guarded by `WHERE status = 'approved'`, so only one caller
 * wins). We consume BEFORE opening the card, and treat a throwing consume as a
 * benign "someone else already claimed this" and skip — so a duplicate event
 * fire (or the `approvals:changed` that `consume()` itself emits) can never
 * open the same card twice. Every failure is logged, never thrown, so one bad
 * proposal cannot take the watcher down.
 */
export class HermesApprovalExecutor {
  private readonly deps: HermesApprovalExecutorDeps
  private readonly logError: LogError

  constructor(deps: HermesApprovalExecutorDeps) {
    this.deps = deps
    this.logError = deps.logError ?? defaultLogError
  }

  /** Subscribe to the approval bus. Idempotent per instance is not required — one instance per app. */
  start(): void {
    this.deps.events.onTyped('approvals:changed', ({ projectId }) => {
      void this.processProject(projectId).catch((err) => this.logError('processProject', err))
    })
  }

  /**
   * Execute every currently-approved proposal for a project. Public so tests can
   * drive it deterministically; production calls it from the event listener.
   */
  async processProject(projectId: string): Promise<void> {
    const approved = this.deps.approvals.listApproved(projectId, ACTION)
    for (const request of approved) {
      await this.executeOne(projectId, request.id).catch((err) =>
        this.logError(`executeOne ${request.id}`, err),
      )
    }
  }

  private async executeOne(projectId: string, approvalId: string): Promise<void> {
    // Claim single-use FIRST. If this throws (already consumed / no longer
    // approved / lost a race), that's the idempotency guard doing its job — skip.
    try {
      this.deps.approvals.consume({ approvalId, projectId, actionType: ACTION })
    } catch {
      return
    }

    // Read the stashed proposal back and re-validate it (the stored payload has
    // been through redaction on disk — treat it as untrusted like any boundary).
    const stored = this.deps.approvals.get(approvalId)
    if (!stored) {
      this.logError(`executeOne ${approvalId}`, new Error('approved request vanished after consume'))
      return
    }
    const payload = proposedSwarmCardPayloadSchema.parse(stored.payload)

    // Open the card, identify the one that appeared, wire its pipeline, start it.
    const before = collectCardIds(this.deps.swarm.board(projectId))
    const after = this.deps.swarm.createCard({
      projectId,
      title: payload.title,
      body: payload.body,
      // Keep the proposal's council provenance on the opened card (Faz 3).
      councilSessionId: payload.councilSessionId,
    })
    const created = firstAddedCard(after, before)
    if (!created) {
      this.logError(`executeOne ${approvalId}`, new Error('could not locate the newly created card'))
      return
    }
    if (payload.assignments && payload.assignments.length > 0) {
      this.deps.swarm.updateCard({ projectId, cardId: created.id, assignments: payload.assignments })
    }
    await this.deps.swarm.startCard({ projectId, cardId: created.id })
  }
}

function collectCardIds(board: readonly BoardColumn[]): Set<string> {
  const ids = new Set<string>()
  for (const column of board) for (const card of column.cards) ids.add(card.id)
  return ids
}

function firstAddedCard(board: readonly BoardColumn[], before: ReadonlySet<string>): KanbanCard | null {
  for (const column of board) for (const card of column.cards) if (!before.has(card.id)) return card
  return null
}
