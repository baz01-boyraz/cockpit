import {
  appendPosition,
  assembleBoard,
  moveCardInList,
  type BoardColumn,
  type CardStatus,
  type KanbanCard,
} from '@shared/kanban'
import type { Db } from '../db/Database'
import { newId, nowIso } from '../util/ids'

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
  constructor(private readonly db: Db) {}

  board(projectId: string): BoardColumn[] {
    return assembleBoard(this.cards(projectId))
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

  removeCard(input: { projectId: string; cardId: string }): BoardColumn[] {
    const card = this.cardOrThrow(input.projectId, input.cardId)
    if (card.status === 'in_progress') {
      throw new Error('Card has a running agent — kill or park it before deleting.')
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
