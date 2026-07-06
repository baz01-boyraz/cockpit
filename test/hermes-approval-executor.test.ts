import { describe, expect, it } from 'vitest'
import { CockpitEvents } from '../electron/main/events'
import { HermesApprovalExecutor } from '../electron/main/services/hermes/HermesApprovalExecutor'
import type { HermesApprovalExecutorDeps } from '../electron/main/services/hermes/HermesApprovalExecutor'
import type { ApprovalActionType, ApprovalRequest } from '../shared/domain'
import type { BoardColumn, KanbanCard } from '../shared/kanban'
import { ROLE_IDS } from '../shared/agent-taxonomy'

const ACTION: ApprovalActionType = 'propose_open_swarm_card'

function makeApproval(over: Partial<ApprovalRequest> = {}): ApprovalRequest {
  return {
    id: 'apr-1',
    projectId: 'p1',
    actionType: ACTION,
    riskLevel: 'medium',
    summary: 'reason — title',
    payload: { title: 'Proposed card', body: 'do the thing' },
    status: 'approved',
    createdAt: 't0',
    resolvedAt: 't1',
    ...over,
  }
}

/** In-memory ApprovalService stand-in with the same consume semantics (single-use, throws otherwise). */
class FakeApprovals {
  private store = new Map<string, ApprovalRequest>()
  consumeCalls = 0

  seed(req: ApprovalRequest): void {
    this.store.set(req.id, req)
  }

  listApproved(projectId: string, actionType: ApprovalActionType): ApprovalRequest[] {
    return [...this.store.values()].filter(
      (r) => r.projectId === projectId && r.actionType === actionType && r.status === 'approved',
    )
  }

  consume(input: { approvalId: string; projectId: string; actionType: ApprovalActionType }): void {
    this.consumeCalls += 1
    const row = this.store.get(input.approvalId)
    if (!row) throw new Error('not found')
    if (row.projectId !== input.projectId || row.actionType !== input.actionType) {
      throw new Error('mismatch')
    }
    if (row.status !== 'approved') throw new Error(`was ${row.status}`)
    this.store.set(input.approvalId, { ...row, status: 'consumed' })
  }

  get(approvalId: string): ApprovalRequest | null {
    return this.store.get(approvalId) ?? null
  }
}

function makeCard(over: Partial<KanbanCard>): KanbanCard {
  return {
    id: 'c1',
    projectId: 'p1',
    title: 'Card',
    body: '',
    status: 'todo',
    position: 1024,
    role: null,
    persona: null,
    agent: null,
    assignments: [],
    pipelineStep: 0,
    terminalSessionId: null,
    worktreePath: null,
    branch: null,
    createdAt: 't0',
    updatedAt: 't0',
    ...over,
  }
}

/** In-memory swarm: createCard actually adds a card so the executor can find it. */
class FakeSwarm {
  private cards: KanbanCard[] = []
  create: Array<{ projectId: string; title: string; body?: string }> = []
  update: unknown[] = []
  start: Array<{ projectId: string; cardId: string }> = []

  board(): BoardColumn[] {
    return [{ status: 'todo', cards: [...this.cards] }]
  }

  createCard(input: { projectId: string; title: string; body?: string }): BoardColumn[] {
    this.create.push(input)
    this.cards = [
      ...this.cards,
      makeCard({ id: `card-${this.cards.length + 1}`, projectId: input.projectId, title: input.title, body: input.body ?? '' }),
    ]
    return this.board()
  }

  updateCard(input: unknown): BoardColumn[] {
    this.update.push(input)
    return this.board()
  }

  async startCard(input: { projectId: string; cardId: string }): Promise<BoardColumn[]> {
    this.start.push(input)
    return this.board()
  }
}

function setup(over: Partial<HermesApprovalExecutorDeps> = {}) {
  const events = new CockpitEvents()
  const approvals = new FakeApprovals()
  const swarm = new FakeSwarm()
  const errors: unknown[] = []
  const executor = new HermesApprovalExecutor({
    events,
    approvals,
    swarm,
    logError: (_ctx, err) => errors.push(err),
    ...over,
  })
  return { events, approvals, swarm, errors, executor }
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('HermesApprovalExecutor — opens a proposed card only after approval', () => {
  it('opens + starts the card from the stashed payload and consumes the approval', async () => {
    const { approvals, swarm, executor } = setup()
    const assignments = [{ role: ROLE_IDS[0], spec: null }]
    approvals.seed(
      makeApproval({ payload: { title: 'Fix flaky test', body: 'it fails in CI', assignments } }),
    )

    await executor.processProject('p1')

    expect(swarm.create).toEqual([{ projectId: 'p1', title: 'Fix flaky test', body: 'it fails in CI' }])
    expect(swarm.update).toEqual([{ projectId: 'p1', cardId: 'card-1', assignments }])
    expect(swarm.start).toEqual([{ projectId: 'p1', cardId: 'card-1' }])
    expect(approvals.get('apr-1')?.status).toBe('consumed')
  })

  it('skips the pipeline update when there are no assignments', async () => {
    const { approvals, swarm, executor } = setup()
    approvals.seed(makeApproval({ payload: { title: 'No pipeline', body: '' } }))

    await executor.processProject('p1')

    expect(swarm.create).toHaveLength(1)
    expect(swarm.update).toEqual([])
    expect(swarm.start).toEqual([{ projectId: 'p1', cardId: 'card-1' }])
  })

  it('does nothing for a rejected request', async () => {
    const { approvals, swarm, executor } = setup()
    approvals.seed(makeApproval({ status: 'rejected' }))

    await executor.processProject('p1')

    expect(swarm.create).toEqual([])
    expect(swarm.start).toEqual([])
    expect(approvals.get('apr-1')?.status).toBe('rejected')
  })

  it('is idempotent — a duplicate run never opens the card twice', async () => {
    const { approvals, swarm, executor } = setup()
    approvals.seed(makeApproval({ payload: { title: 'Once only', body: '' } }))

    await executor.processProject('p1')
    await executor.processProject('p1')

    expect(swarm.create).toHaveLength(1)
    expect(swarm.start).toHaveLength(1)
    expect(approvals.get('apr-1')?.status).toBe('consumed')
  })

  it('runs off the approvals:changed event once started', async () => {
    const { events, approvals, swarm, executor } = setup()
    executor.start()
    approvals.seed(makeApproval({ payload: { title: 'Via event', body: '' } }))

    events.emitTyped('approvals:changed', { projectId: 'p1' })
    await flush()

    expect(swarm.create).toHaveLength(1)
    expect(swarm.start).toHaveLength(1)
    expect(approvals.get('apr-1')?.status).toBe('consumed')
  })

  it('does not crash the watcher when opening a card throws', async () => {
    const { approvals, swarm, errors, executor } = setup()
    // startCard rejects; the executor must swallow+log it, not propagate.
    swarm.startCard = async () => {
      throw new Error('worktree busy')
    }
    approvals.seed(makeApproval({ payload: { title: 'Boom', body: '' } }))

    await expect(executor.processProject('p1')).resolves.toBeUndefined()
    expect(errors.length).toBeGreaterThan(0)
    // The approval was still consumed (single-use), so it won't be retried forever.
    expect(approvals.get('apr-1')?.status).toBe('consumed')
  })
})
