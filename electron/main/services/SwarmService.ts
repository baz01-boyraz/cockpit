import {
  appendPosition,
  assembleBoard,
  moveCardInList,
  type BoardColumn,
  type CardStatus,
  type KanbanCard,
} from '@shared/kanban'
import { buildWorkerCommand } from '@shared/swarm-worker'
import type { TerminalSession } from '@shared/domain'
import type { Db } from '../db/Database'
import type { CockpitEvents } from '../events'
import { newId, nowIso } from '../util/ids'
import type { AuditLogService } from './AuditLogService'
import type { MemoryHubService } from './MemoryHubService'

/** The TerminalManager capabilities the swarm needs — injectable for tests. */
export interface WorkerSpawner {
  create(input: {
    projectId: string
    name?: string
    role?: 'claude'
    cwd?: string
    command?: string | null
  }): TerminalSession
  kill(sessionId: string): void
}

/** Worktree lifecycle (SwarmWorktrees) — injectable for tests. */
export interface WorktreeOps {
  create(projectPath: string, title: string, cardId: string): Promise<{ path: string; branch: string }>
  removeIfClean(projectPath: string, worktreePath: string): Promise<void>
}

/** Parallel cards ceiling (plan D6). Raise only after Gate 6 passes at 4. */
export const RUNNING_CAP = 3

interface CardRow {
  id: string
  project_id: string
  title: string
  body: string
  status: string
  position: number
  role: string | null
  persona: string | null
  terminal_session_id: string | null
  worktree_path: string | null
  branch: string | null
  created_at: string
  updated_at: string
}

/**
 * Phase 6 orchestrator (plan D1): owns the Kanban board. 6.1 scope is CRUD
 * only — no agent execution yet. All board rules live in `shared/kanban.ts`
 * (D5); this service is a thin persistence layer over that kernel.
 *
 * Renderer-driven mutations are always the `user` actor: transitions entering
 * or leaving `in_progress` are refused here, because those mirror real
 * spawn/exit/park facts that only this service (6.2+) may record.
 */
export class SwarmService {
  constructor(
    private readonly db: Db,
    private readonly terminals: WorkerSpawner,
    private readonly memory: Pick<MemoryHubService, 'list'>,
    private readonly audit: AuditLogService,
    events: CockpitEvents,
    private readonly projects: { get(projectId: string): { path: string } },
    private readonly worktrees: WorktreeOps,
  ) {
    // 6.4: any card still in_progress at construction is an orphan — its
    // worker died with the previous app instance (TerminalManager already
    // reconciled the session rows). Park it; Start on a parked card resumes
    // in the SAME worktree, so no work is lost.
    const orphans = this.db
      .prepare(`SELECT id, project_id, title FROM kanban_cards WHERE status = 'in_progress'`)
      .all() as Pick<CardRow, 'id' | 'project_id' | 'title'>[]
    for (const o of orphans) {
      this.db
        .prepare(`UPDATE kanban_cards SET status = 'parked', updated_at = ? WHERE id = ?`)
        .run(nowIso(), o.id)
      this.audit.record({
        projectId: o.project_id,
        actor: 'system',
        actionType: 'swarm.card_orphaned',
        summary: `Card "${o.title}" was running when the app closed — parked for resume`,
        payload: { cardId: o.id },
      })
    }
    // A worker's terminal exiting is the fact that ends a run: its card moves
    // to In review for the human. Killed and non-zero exits land there too —
    // partial work still deserves eyes, never silent disappearance.
    events.onTyped('terminal:exit', (evt) => {
      try {
        this.onWorkerExit(evt.sessionId, evt.exitCode)
      } catch {
        // Event handlers must never throw into the emitter; the board can
        // always be reconciled from rows (6.4).
      }
    })
  }

  board(projectId: string): BoardColumn[] {
    return assembleBoard(this.cards(projectId))
  }

  /**
   * Card → running agent. Each card gets its own git worktree on a
   * `swarm/<slug>` branch (plan D4) so parallel workers never clobber each
   * other or the human's working tree; a parked card resumes in the SAME
   * worktree (6.4). Cap: RUNNING_CAP concurrent cards (plan D6). Falls back
   * to the project root when worktree creation fails (e.g. not a git repo) —
   * a refused start would be worse than an unisolated one.
   */
  async startCard(input: { projectId: string; cardId: string }): Promise<BoardColumn[]> {
    const card = this.cardOrThrow(input.projectId, input.cardId)
    if (card.status !== 'todo' && card.status !== 'parked') {
      throw new Error('Only a To do or Parked card can start.')
    }
    const cards = this.cards(input.projectId)
    const running = cards.filter((c) => c.status === 'in_progress').length
    if (running >= RUNNING_CAP) {
      throw new Error(`Concurrency cap reached (${RUNNING_CAP}) — park or finish a running card first.`)
    }

    const projectPath = this.projects.get(input.projectId).path
    let worktree: { path: string; branch: string } | null =
      card.worktreePath && card.branch ? { path: card.worktreePath, branch: card.branch } : null
    if (!worktree) {
      try {
        worktree = await this.worktrees.create(projectPath, card.title, card.id)
      } catch {
        worktree = null
      }
    }

    const hubNames = this.hubNoteNames(input.projectId)
    const session = this.terminals.create({
      projectId: input.projectId,
      name: `Swarm — ${card.title.slice(0, 40)}`,
      role: 'claude',
      cwd: worktree?.path,
      command: buildWorkerCommand({ title: card.title, body: card.body }, hubNames),
    })

    const now = nowIso()
    this.db
      .prepare(
        `UPDATE kanban_cards SET terminal_session_id = ?, worktree_path = ?, branch = ?,
         updated_at = ? WHERE id = ?`,
      )
      .run(session.id, worktree?.path ?? null, worktree?.branch ?? null, now, card.id)
    const next = moveCardInList(this.cards(input.projectId), card.id, 'in_progress', 0, 'service', now)
    this.persistChanges(cards, next)

    this.audit.record({
      projectId: input.projectId,
      actor: 'user',
      actionType: 'swarm.start_card',
      summary: `Started swarm card "${card.title}"${worktree ? ` in ${worktree.branch}` : ' (project root — no worktree)'}`,
      payload: { cardId: card.id, sessionId: session.id, worktree: worktree?.branch ?? null },
    })
    return assembleBoard(next)
  }

  /**
   * Park a running card: the card leaves Running FIRST (so the exit handler
   * ignores the kill), then its worker dies. Start on the parked card resumes
   * in the same worktree.
   */
  parkCard(input: { projectId: string; cardId: string }): BoardColumn[] {
    const card = this.cardOrThrow(input.projectId, input.cardId)
    if (card.status !== 'in_progress') throw new Error('Only a running card can be parked.')
    const cards = this.cards(input.projectId)
    const next = moveCardInList(cards, card.id, 'parked', 0, 'service', nowIso())
    this.persistChanges(cards, next)
    if (card.terminalSessionId) {
      try {
        this.terminals.kill(card.terminalSessionId)
      } catch {
        // Session may already be gone; the card is parked either way.
      }
    }
    this.audit.record({
      projectId: input.projectId,
      actor: 'user',
      actionType: 'swarm.park_card',
      summary: `Parked swarm card "${card.title}"`,
      payload: { cardId: card.id },
    })
    return assembleBoard(next)
  }

  private onWorkerExit(sessionId: string, exitCode: number): void {
    const row = this.db
      .prepare(
        `SELECT * FROM kanban_cards WHERE terminal_session_id = ? AND status = 'in_progress'`,
      )
      .get(sessionId) as CardRow | undefined
    if (!row) return
    const cards = this.cards(row.project_id)
    const next = moveCardInList(cards, row.id, 'in_review', 0, 'service', nowIso())
    this.persistChanges(cards, next)
    this.audit.record({
      projectId: row.project_id,
      actor: 'system',
      actionType: 'swarm.card_exited',
      summary: `Swarm card "${row.title}" finished (exit ${exitCode}) — moved to In review`,
      payload: { cardId: row.id, sessionId, exitCode },
    })
  }

  /** Read-only hub pointers for the worker prompt; a missing hub is fine. */
  private hubNoteNames(projectId: string): string[] {
    try {
      return this.memory.list(projectId).notes.map((n) => n.name)
    } catch {
      return []
    }
  }

  createCard(input: { projectId: string; title: string; body?: string }): BoardColumn[] {
    const now = nowIso()
    this.db
      .prepare(
        `INSERT INTO kanban_cards
         (id, project_id, title, body, status, position, created_at, updated_at)
         VALUES (@id, @projectId, @title, @body, 'todo', @position, @now, @now)`,
      )
      .run({
        id: newId('card'),
        projectId: input.projectId,
        title: input.title,
        body: input.body ?? '',
        position: appendPosition(this.cards(input.projectId), 'todo'),
        now,
      })
    return this.board(input.projectId)
  }

  updateCard(input: {
    projectId: string
    cardId: string
    title?: string
    body?: string
    role?: string | null
    persona?: string | null
  }): BoardColumn[] {
    const card = this.cardOrThrow(input.projectId, input.cardId)
    this.db
      .prepare(
        `UPDATE kanban_cards SET title = @title, body = @body, role = @role,
         persona = @persona, updated_at = @now WHERE id = @id`,
      )
      .run({
        id: card.id,
        title: input.title ?? card.title,
        body: input.body ?? card.body,
        role: input.role === undefined ? card.role : input.role,
        persona: input.persona === undefined ? card.persona : input.persona,
        now: nowIso(),
      })
    return this.board(input.projectId)
  }

  moveCard(input: {
    projectId: string
    cardId: string
    to: CardStatus
    index: number
  }): BoardColumn[] {
    this.cardOrThrow(input.projectId, input.cardId)
    const cards = this.cards(input.projectId)
    const next = moveCardInList(cards, input.cardId, input.to, input.index, 'user', nowIso())
    this.persistChanges(cards, next)
    return assembleBoard(next)
  }

  async removeCard(input: { projectId: string; cardId: string }): Promise<BoardColumn[]> {
    const card = this.cardOrThrow(input.projectId, input.cardId)
    if (card.status === 'in_progress') {
      throw new Error('Card has a running agent — kill or park it before deleting.')
    }
    if (card.worktreePath) {
      // Dirty worktrees refuse removal (and so does the card) — committed
      // work survives on the swarm/<slug> branch either way.
      await this.worktrees.removeIfClean(this.projects.get(input.projectId).path, card.worktreePath)
    }
    this.db.prepare('DELETE FROM kanban_cards WHERE id = ?').run(card.id)
    return this.board(input.projectId)
  }

  /** Persist only the rows the kernel actually changed, atomically. */
  private persistChanges(prev: readonly KanbanCard[], next: readonly KanbanCard[]): void {
    const before = new Map(prev.map((c) => [c.id, c]))
    const changed = next.filter((c) => {
      const p = before.get(c.id)
      return !p || p.status !== c.status || p.position !== c.position
    })
    const update = this.db.prepare(
      'UPDATE kanban_cards SET status = ?, position = ?, updated_at = ? WHERE id = ?',
    )
    this.db.transaction(() => {
      for (const c of changed) update.run(c.status, c.position, c.updatedAt, c.id)
    })()
  }

  private cards(projectId: string): KanbanCard[] {
    const rows = this.db
      .prepare('SELECT * FROM kanban_cards WHERE project_id = ?')
      .all(projectId) as CardRow[]
    return rows.map((r) => this.toCard(r))
  }

  private cardOrThrow(projectId: string, cardId: string): KanbanCard {
    const row = this.db
      .prepare('SELECT * FROM kanban_cards WHERE id = ? AND project_id = ?')
      .get(cardId, projectId) as CardRow | undefined
    if (!row) throw new Error(`Card ${cardId} not found in this project.`)
    return this.toCard(row)
  }

  private toCard(row: CardRow): KanbanCard {
    return {
      id: row.id,
      projectId: row.project_id,
      title: row.title,
      body: row.body,
      status: row.status as CardStatus,
      position: row.position,
      role: row.role,
      persona: row.persona,
      terminalSessionId: row.terminal_session_id,
      worktreePath: row.worktree_path,
      branch: row.branch,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }
  }
}
