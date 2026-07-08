import {
  appendPosition,
  assembleBoard,
  moveCardInList,
  type BoardColumn,
  type CardStatus,
  type KanbanCard,
} from '@shared/kanban'
import { buildWorkerCommand } from '@shared/swarm-worker'
import { composeCouncilBrief, type CouncilResult } from '@shared/council'
import {
  assignmentLabel,
  assignmentPrompt,
  legacyIdentityToAssignment,
  parseAssignments,
  pipelinePrompt,
  type Assignment,
} from '@shared/agent-taxonomy'
import { classifyRoles } from '@shared/role-router'
import { composeAgentText, type NamedAgent } from '@shared/named-agents'
import type { AgentUsageReport, TerminalSession } from '@shared/domain'
import {
  extractAcceptanceCriteria,
  formatCompletionSummary,
  type CompletionReport,
} from '@shared/completion-report'
import type { DiffStat } from '@shared/review'
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

/** Turn-finished signalling (SwarmDoneSignal) — injectable for tests. */
export interface DoneSignalOps {
  arm(projectPath: string, worktreePath: string): void
  consume(worktreePath: string): boolean
}

/**
 * The council-session lookup the swarm needs at spawn (Faz 2a) — the narrow
 * slice of `CouncilSessionStore`, structural so tests can fake it. A card's
 * approved session is read here so its conclusions ride the worker's opening
 * prompt; the store returns null for a missing or corrupt-JSON row.
 */
export interface CouncilSessionReader {
  /** `projectId` is part of the slice so the brief loader can scope-check the
   *  (renderer/tool-supplied) session id against the card's own project. */
  get(id: string): { projectId: string; result: CouncilResult } | null
}

/**
 * The read-only diff-stat capability the completion report needs (Faz 2.5) —
 * structurally satisfied by `ReviewService.diffStat`, so the swarm reuses the
 * exact same git plumbing the board badge already runs rather than duplicating
 * it. Injectable and optional so tests (and a degraded build) never need git.
 */
export interface DiffStatReader {
  diffStat(projectId: string, opts?: { dir?: string }): Promise<DiffStat>
}

/**
 * Best-effort OS notification sink (Faz 2.5). The concrete wiring guards behind
 * `Notification.isSupported()`; this service additionally wraps every call in a
 * try/catch so a completion announcement can never break a board transition.
 */
export type SwarmNotifier = (input: { title: string; body: string }) => void

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
  agent: string | null
  assignments: string
  pipeline_step: number
  council_session_id: string | null
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
    private readonly events: CockpitEvents,
    private readonly projects: { get(projectId: string): { path: string } },
    private readonly worktrees: WorktreeOps,
    private readonly agentUsage?: { getReport(): Promise<AgentUsageReport> },
    private readonly namedAgents?: { find(projectId: string, slug: string): NamedAgent | null },
    private readonly doneSignal?: DoneSignalOps,
    private readonly councilSessions?: CouncilSessionReader,
    private readonly review?: DiffStatReader,
    private readonly notifier?: SwarmNotifier,
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
    this.reconcileDoneSignals(projectId)
    return assembleBoard(this.cards(projectId))
  }

  /**
   * The other half of the worker lifecycle. Workers are INTERACTIVE `claude`
   * sessions (so the human can keep talking to them), which means the pty
   * rarely exits on its own — `terminal:exit` alone left cards Running until
   * someone killed the terminal. The Stop hook armed at start touches a
   * sentinel in the worktree whenever the worker ends a turn; consuming it
   * here (the board read path — the panel polls while cards run) moves the
   * card to In review while the terminal stays open for follow-ups. Later
   * turn-end signals for an already-moved card are consumed and ignored.
   */
  private reconcileDoneSignals(projectId: string): void {
    if (!this.doneSignal) return
    const signalled = this.cards(projectId).filter(
      (c) => c.worktreePath !== null && this.doneSignal!.consume(c.worktreePath!),
    )
    for (const card of signalled) {
      if (card.status !== 'in_progress') continue
      this.advanceOrFinish(projectId, card)
    }
  }

  /**
   * A running worker just finished its turn. If the card's pipeline has more
   * steps, advance to the next role IN THE SAME WORKTREE — retire the finished
   * worker, spawn the next, keep the card Running so the chain flows without a
   * human touch. Otherwise the card is done for review: it moves to In review
   * with its terminal left open for follow-up conversation.
   */
  private advanceOrFinish(projectId: string, card: KanbanCard): void {
    const assignments = card.assignments
    const nextStep = card.pipelineStep + 1
    const canAdvance =
      assignments.length > 1 &&
      nextStep < assignments.length &&
      card.worktreePath !== null &&
      card.branch !== null

    if (canAdvance) {
      const projectPath = this.projects.get(projectId).path
      const worktree = { path: card.worktreePath as string, branch: card.branch as string }
      // Re-arm the sentinel for the next step, then spawn it. The row's session
      // id is repointed to the new worker BEFORE the old one is killed, so the
      // retiring worker's exit can never match this card (onWorkerExit is a
      // no-op for it) and the card stays Running across the handoff.
      this.doneSignal?.arm(projectPath, worktree.path)
      const session = this.spawnWorker(projectId, card, worktree, assignments, nextStep, this.councilBriefFor(card))
      this.db
        .prepare(`UPDATE kanban_cards SET terminal_session_id = ?, pipeline_step = ?, updated_at = ? WHERE id = ?`)
        .run(session.id, nextStep, nowIso(), card.id)
      if (card.terminalSessionId) {
        try {
          this.terminals.kill(card.terminalSessionId)
        } catch {
          // The finished worker's terminal may already be gone.
        }
      }
      this.audit.record({
        projectId,
        actor: 'system',
        actionType: 'swarm.pipeline_advance',
        summary: `Swarm card "${card.title}" advanced to ${assignmentLabel(assignments[nextStep])} (step ${nextStep + 1}/${assignments.length})`,
        payload: { cardId: card.id, sessionId: session.id, step: nextStep },
      })
      return
    }

    const cards = this.cards(projectId)
    const next = moveCardInList(cards, card.id, 'in_review', 0, 'service', nowIso())
    this.persistChanges(cards, next)
    this.audit.record({
      projectId,
      actor: 'system',
      actionType: 'swarm.card_done_signal',
      summary: `Swarm card "${card.title}" — worker finished${assignments.length > 1 ? ' the pipeline' : ' its turn'}; moved to In review (terminal stays open)`,
      payload: { cardId: card.id, sessionId: card.terminalSessionId },
    })
    // The transition is now durable; announcing it (event + notification) is a
    // best-effort epilogue that must never unwind the move above.
    void this.announceCompletion(projectId, card.id, card.title)
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

    await this.assertQuotaAllows()

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

    // Auto-assign at Start: an unassigned card (no explicit pipeline, no named
    // override) is routed to a role pipeline from its text — the "give a task,
    // the swarm picks the agents" path. An explicit pipeline or a named agent
    // is honoured as-is. Steps run sequentially in this one worktree.
    const assignments = this.resolveAssignments(card)
    const step = Math.min(card.pipelineStep, Math.max(0, assignments.length - 1))

    // Arm the turn-finished signal BEFORE the worker spawns: clears any stale
    // sentinel from a previous run and installs the Stop hook the new session
    // will fire. Without a worktree there is no safe place for the hook
    // (we never write into the user's real project), so the card falls back
    // to the exit/manual lifecycle — and to a single step (no done-signal to
    // advance the pipeline on).
    if (worktree) this.doneSignal?.arm(projectPath, worktree.path)

    // The card's approved council session (if any) rides the worker's opening
    // prompt. A degraded/missing session yields null — never a refused start —
    // and the fact is recorded on the audit line either way.
    const councilBrief = this.councilBriefFor(card)
    const session = this.spawnWorker(input.projectId, card, worktree, assignments, step, councilBrief)

    const now = nowIso()
    this.db
      .prepare(
        `UPDATE kanban_cards SET terminal_session_id = ?, worktree_path = ?, branch = ?,
         assignments = ?, pipeline_step = ?, updated_at = ? WHERE id = ?`,
      )
      .run(
        session.id,
        worktree?.path ?? null,
        worktree?.branch ?? null,
        JSON.stringify(assignments),
        step,
        now,
        card.id,
      )
    const next = moveCardInList(this.cards(input.projectId), card.id, 'in_progress', 0, 'service', now)
    this.persistChanges(cards, next)

    this.audit.record({
      projectId: input.projectId,
      actor: 'user',
      actionType: 'swarm.start_card',
      summary: `Started swarm card "${card.title}"${this.pipelineSummary(assignments, step)}${worktree ? ` in ${worktree.branch}` : ' (project root — no worktree)'}`,
      payload: { cardId: card.id, sessionId: session.id, worktree: worktree?.branch ?? null, assignments, step, councilBrief: councilBrief !== null },
    })
    return assembleBoard(next)
  }

  /**
   * The pipeline a card runs. An explicit list (set on the card) wins; a named
   * override drives its own identity and needs no role pipeline; otherwise the
   * router assigns roles from the card's text at Start.
   */
  private resolveAssignments(card: KanbanCard): Assignment[] {
    if (card.assignments.length > 0) return card.assignments
    // A named override or a legacy manual role/persona drives identity the old
    // way (spawnWorker falls back to it); auto-assign only fires for a card
    // with no assignment of any kind — the "gave a task, picked no agent" case.
    if (card.agent || card.role || card.persona) return []
    return classifyRoles(card.title, card.body).pipeline.map((p) => ({ role: p.role, spec: p.spec ?? null }))
  }

  /**
   * The council brief a card's worker opens with, or null. The session is
   * HISTORY: a missing store, an unset/dangling id, a corrupt-JSON row, or a
   * verdict-less result all degrade to no brief — a spec-gate meeting that can't
   * be read must never block a start.
   */
  private councilBriefFor(card: KanbanCard): string | null {
    if (!card.councilSessionId || !this.councilSessions) return null
    try {
      const session = this.councilSessions.get(card.councilSessionId)
      // Scope guard (argos L1): councilSessionId is renderer/tool-supplied, so a
      // card must never pull another project's session content into its worker
      // prompt — a cross-project id degrades to no brief, like a missing one.
      if (!session || session.projectId !== card.projectId) return null
      return composeCouncilBrief(session.result)
    } catch {
      return null
    }
  }

  /** Launch the worker for one pipeline step (or a named/legacy identity). */
  private spawnWorker(
    projectId: string,
    card: KanbanCard,
    worktree: { path: string; branch: string } | null,
    assignments: Assignment[],
    step: number,
    councilBrief: string | null = null,
  ): TerminalSession {
    const hubNames = this.hubNoteNames(projectId)
    // Identity precedence: a Named Agent speaks with its authored voice; else
    // the pipeline step's role/spec prompt; else the legacy manual role/persona.
    const named = card.agent ? (this.namedAgents?.find(projectId, card.agent) ?? null) : null
    // A legacy manual card (role/persona set, no pipeline, no named agent) folds
    // onto the canonical taxonomy; an empty/unknown role yields null → no
    // identity text, the same as an identity-less card.
    const legacy = named ? null : legacyIdentityToAssignment(card.role, card.persona)
    const identityText = named
      ? composeAgentText(named)
      : assignments.length > 0
        ? pipelinePrompt(assignments[step], step, assignments.length)
        : legacy
          ? assignmentPrompt(legacy)
          : ''
    const badge = named
      ? `${named.displayName}: `
      : assignments.length > 0
        ? `${assignmentLabel(assignments[step])}: `
        : ''
    return this.terminals.create({
      projectId,
      name: `Swarm — ${badge}${card.title.slice(0, 40)}`,
      role: 'claude',
      cwd: worktree?.path,
      command: buildWorkerCommand(
        { title: card.title, body: card.body },
        hubNames,
        identityText,
        named?.model ?? null,
        councilBrief,
      ),
    })
  }

  /** Human summary of a card's pipeline for audit lines. */
  private pipelineSummary(assignments: Assignment[], step: number): string {
    if (assignments.length === 0) return ''
    const chain = assignments.map(assignmentLabel).join(' → ')
    return assignments.length > 1 ? ` · ${chain} (step ${step + 1}/${assignments.length})` : ` · ${chain}`
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
    // Same best-effort announcement as the done-signal path — the card is
    // already in In review; the notification is an epilogue, never a gate.
    void this.announceCompletion(row.project_id, row.id, row.title)
  }

  /**
   * Compute a card's completion report on demand (Faz 2.5) — NO new table. The
   * card row supplies title/branch/body/council provenance; the diff stat reuses
   * `ReviewService.diffStat` over the card's worktree (a card with no worktree,
   * or a missing reader, yields a null diff stat rather than an error).
   */
  async completionReport(projectId: string, cardId: string): Promise<CompletionReport> {
    const card = this.cardOrThrow(projectId, cardId)
    let diffStat: DiffStat | null = null
    if (card.worktreePath && this.review) {
      try {
        diffStat = await this.review.diffStat(projectId, { dir: card.worktreePath })
      } catch {
        // A non-repo/removed worktree degrades to no diff stat — the report is
        // still worth returning (title, branch, acceptance criteria).
        diffStat = null
      }
    }
    return {
      cardId: card.id,
      title: card.title,
      branch: card.branch,
      diffStat,
      acceptance: extractAcceptanceCriteria(card.body),
      hasCouncilSpec: card.councilSessionId !== null,
      finishedAt: card.updatedAt,
    }
  }

  /**
   * Fire the `swarm:cardCompleted` renderer event and a macOS notification for a
   * freshly-reviewable card. Wholly best-effort: the diff stat, the event, and
   * the notification are each isolated so a slow git call or an unsupported
   * Notification host can never surface as a thrown board transition.
   */
  private async announceCompletion(projectId: string, cardId: string, title: string): Promise<void> {
    try {
      const report = await this.completionReport(projectId, cardId)
      const summary = formatCompletionSummary(report)
      this.events.emitTyped('swarm:cardCompleted', { projectId, cardId, title, summary })
      try {
        this.notifier?.({ title: 'Swarm — ready for review', body: summary })
      } catch {
        // Notifications are best-effort; a host that refuses one must not
        // break the event fan-out above.
      }
    } catch {
      // The transition already happened and the board reflects it — a failed
      // announcement is invisible by design, never a user-facing error.
    }
  }

  /**
   * 6.6: refuse new spawns when a Claude quota window is exhausted (existing
   * workers keep running — parking is graceful, never a kill). A probe
   * failure or unavailable provider never blocks work.
   */
  private async assertQuotaAllows(): Promise<void> {
    if (!this.agentUsage) return
    let exhausted = false
    try {
      const report = await this.agentUsage.getReport()
      const claude = report.providers.find((p) => p.provider === 'claude')
      exhausted = Boolean(claude?.available && claude.windows.some((w) => w.usedPercent >= 100))
    } catch {
      return
    }
    if (exhausted) {
      throw new Error(
        'Claude usage window is exhausted — the card stays put; start it again after the window resets.',
      )
    }
  }

  /** Read-only hub pointers for the worker prompt; a missing hub is fine. */
  private hubNoteNames(projectId: string): string[] {
    try {
      return this.memory.list(projectId).notes.map((n) => n.name)
    } catch {
      return []
    }
  }

  createCard(input: {
    projectId: string
    title: string
    body?: string
    councilSessionId?: string | null
  }): BoardColumn[] {
    const now = nowIso()
    try {
      this.db
        .prepare(
          `INSERT INTO kanban_cards
           (id, project_id, title, body, status, position, council_session_id, created_at, updated_at)
           VALUES (@id, @projectId, @title, @body, 'todo', @position, @councilSessionId, @now, @now)`,
        )
        .run({
          id: newId('card'),
          projectId: input.projectId,
          title: input.title,
          body: input.body ?? '',
          position: appendPosition(this.cards(input.projectId), 'todo'),
          councilSessionId: input.councilSessionId ?? null,
          now,
        })
    } catch (err) {
      // better-sqlite3 surfaces an unhelpful raw "FOREIGN KEY constraint
      // failed" here when projectId doesn't match a real `projects` row —
      // most commonly a Hermes MCP call that guessed the id instead of
      // reading it from COCKPIT_PROJECT_ID (see AGENTS.md).
      const code = (err as { code?: string }).code
      if (code === 'SQLITE_CONSTRAINT_FOREIGNKEY' || code === 'SQLITE_CONSTRAINT') {
        throw new Error(
          `Project "${input.projectId}" is not a registered cockpit project — it must exist ` +
            `in the Dashboard before a Swarm card can be created for it.`,
        )
      }
      throw err
    }
    return this.board(input.projectId)
  }

  updateCard(input: {
    projectId: string
    cardId: string
    title?: string
    body?: string
    role?: string | null
    persona?: string | null
    agent?: string | null
    assignments?: Assignment[]
    councilSessionId?: string | null
  }): BoardColumn[] {
    const card = this.cardOrThrow(input.projectId, input.cardId)
    // A changed pipeline starts fresh at step 0; leaving it unset preserves
    // how far a resumed card has already advanced.
    const assignments = input.assignments === undefined ? card.assignments : input.assignments
    const pipelineStep = input.assignments === undefined ? card.pipelineStep : 0
    this.db
      .prepare(
        `UPDATE kanban_cards SET title = @title, body = @body, role = @role,
         persona = @persona, agent = @agent, assignments = @assignments,
         pipeline_step = @step, council_session_id = @councilSessionId,
         updated_at = @now WHERE id = @id`,
      )
      .run({
        id: card.id,
        title: input.title ?? card.title,
        body: input.body ?? card.body,
        role: input.role === undefined ? card.role : input.role,
        persona: input.persona === undefined ? card.persona : input.persona,
        agent: input.agent === undefined ? card.agent : input.agent,
        assignments: JSON.stringify(assignments),
        step: pipelineStep,
        councilSessionId:
          input.councilSessionId === undefined ? card.councilSessionId : input.councilSessionId,
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
      agent: row.agent,
      assignments: parseAssignments(safeJsonParse(row.assignments)),
      pipelineStep: row.pipeline_step ?? 0,
      councilSessionId: row.council_session_id ?? null,
      terminalSessionId: row.terminal_session_id,
      worktreePath: row.worktree_path,
      branch: row.branch,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }
  }
}

/** Tolerant JSON parse for the persisted assignments column; never throws. */
function safeJsonParse(text: string | null): unknown {
  if (!text) return []
  try {
    return JSON.parse(text)
  } catch {
    return []
  }
}
