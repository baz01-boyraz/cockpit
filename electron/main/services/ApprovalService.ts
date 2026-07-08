import type { ApprovalActionType, ApprovalRequest, ApprovalStatus } from '@shared/domain'
import { riskLevelFor } from '@shared/approval-rules'
import { redactPayload } from '@shared/redaction'
import type { Db } from '../db/Database'
import type { CockpitEvents } from '../events'
import { newId, nowIso, safeJson } from '../util/ids'
import type { AuditLogService } from './AuditLogService'
import type { SentinelService } from './SentinelService'

/** The narrow sentinel slice this service feeds — structural so tests pass
 *  `undefined` (no-op). Sentinel never depends on ApprovalService. */
type SentinelReporter = Pick<SentinelService, 'report'>

interface ApprovalRow {
  id: string
  project_id: string
  action_type: string
  risk_level: string
  command_or_payload_json: string
  summary: string
  status: string
  created_at: string
  resolved_at: string | null
}

/**
 * Owns the approval gate. Risky/destructive actions (push, force-push, deploy,
 * delete, db reset, env write) are recorded here as pending requests and must be
 * explicitly approved by the user before any execution path proceeds. Every
 * create/decide is mirrored to the audit log.
 */
export class ApprovalService {
  constructor(
    private readonly db: Db,
    private readonly audit: AuditLogService,
    private readonly events: CockpitEvents,
    /** Optional Faz A collaborator — a new request raises an `alert` signal.
     *  Undefined in tests (no-op); sentinel never depends on this service. */
    private readonly sentinel?: SentinelReporter,
  ) {}

  request(input: {
    projectId: string
    actionType: ApprovalActionType
    summary: string
    payload?: Record<string, unknown>
  }): ApprovalRequest {
    const req: ApprovalRequest = {
      id: newId('apr'),
      projectId: input.projectId,
      actionType: input.actionType,
      riskLevel: riskLevelFor(input.actionType),
      summary: input.summary,
      payload: (redactPayload(input.payload ?? {}) as Record<string, unknown>) ?? {},
      status: 'pending',
      createdAt: nowIso(),
      resolvedAt: null,
    }
    this.db
      .prepare(
        `INSERT INTO approval_requests
         (id, project_id, action_type, risk_level, command_or_payload_json, summary, status, created_at, resolved_at)
         VALUES (@id, @projectId, @actionType, @riskLevel, @payload, @summary, @status, @createdAt, NULL)`,
      )
      .run({
        id: req.id,
        projectId: req.projectId,
        actionType: req.actionType,
        riskLevel: req.riskLevel,
        payload: JSON.stringify(req.payload),
        summary: req.summary,
        status: req.status,
        createdAt: req.createdAt,
      })

    this.audit.record({
      projectId: req.projectId,
      actor: 'ai',
      actionType: `approval.request:${req.actionType}`,
      summary: `Requested approval — ${req.summary}`,
      payload: req.payload,
    })
    this.events.emitTyped('approvals:changed', { projectId: req.projectId })
    // Faz A: a filed approval is an `alert` — it blocks a mutating action until
    // the human decides, so it earns a feed entry, a toast, and a macOS
    // notification. Fire-and-forget; report() never throws.
    this.sentinel?.report({
      projectId: req.projectId,
      severity: 'alert',
      source: 'approval',
      title: `Approval needed: ${req.summary}`,
      summary: `A ${req.actionType} action is waiting for your decision.`,
      context: `action=${req.actionType} · risk=${req.riskLevel}`,
    })
    return req
  }

  decide(approvalId: string, approve: boolean): ApprovalRequest {
    const row = this.db
      .prepare('SELECT * FROM approval_requests WHERE id = ?')
      .get(approvalId) as ApprovalRow | undefined
    if (!row) throw new Error(`Approval request ${approvalId} not found`)
    if (row.status !== 'pending') return this.toRequest(row)

    const status: ApprovalStatus = approve ? 'approved' : 'rejected'
    const resolvedAt = nowIso()
    this.db
      .prepare('UPDATE approval_requests SET status = ?, resolved_at = ? WHERE id = ?')
      .run(status, resolvedAt, approvalId)

    this.audit.record({
      projectId: row.project_id,
      actor: 'user',
      actionType: `approval.${status}:${row.action_type}`,
      summary: `${approve ? 'Approved' : 'Rejected'} — ${row.summary}`,
      payload: safeJson(row.command_or_payload_json, {}),
    })
    this.events.emitTyped('approvals:changed', { projectId: row.project_id })
    return this.toRequest({ ...row, status, resolved_at: resolvedAt })
  }

  /**
   * The execution-side gate. Verifies that an approval exists, belongs to this
   * project and action type, and was approved — then marks it consumed so it
   * can never authorize a second execution. Throws (blocking the caller)
   * otherwise. Every mutating handler must pass through here before running a
   * gated action; the renderer alone is never trusted to enforce the gate.
   */
  consume(input: { approvalId: string; projectId: string; actionType: ApprovalActionType }): void {
    const row = this.db
      .prepare('SELECT * FROM approval_requests WHERE id = ?')
      .get(input.approvalId) as ApprovalRow | undefined
    if (!row) {
      throw new Error(`Approval ${input.approvalId} not found — request approval first.`)
    }
    if (row.project_id !== input.projectId || row.action_type !== input.actionType) {
      throw new Error('Approval does not match this action — request a new approval.')
    }
    if (row.status === 'pending') {
      throw new Error('Approval is still pending — approve it first.')
    }
    if (row.status !== 'approved') {
      throw new Error(`Approval was ${row.status} — request a new approval.`)
    }

    // The status guard in the UPDATE makes consumption atomic: even if two
    // calls race, only one sees changes === 1 and proceeds.
    const res = this.db
      .prepare(`UPDATE approval_requests SET status = 'consumed' WHERE id = ? AND status = 'approved'`)
      .run(input.approvalId)
    if (res.changes !== 1) {
      throw new Error('Approval was already consumed — request a new approval.')
    }

    this.audit.record({
      projectId: input.projectId,
      actor: 'system',
      actionType: `approval.consumed:${input.actionType}`,
      summary: `Approval consumed — ${row.summary}`,
      payload: safeJson(row.command_or_payload_json, {}),
    })
    this.events.emitTyped('approvals:changed', { projectId: input.projectId })
  }

  /** Read a single request (with its stored payload) by id, or null if unknown. */
  get(approvalId: string): ApprovalRequest | null {
    const row = this.db
      .prepare('SELECT * FROM approval_requests WHERE id = ?')
      .get(approvalId) as ApprovalRow | undefined
    return row ? this.toRequest(row) : null
  }

  /**
   * Every currently-approved (not yet consumed) request of one action type for a
   * project, oldest first. The approval-execution watcher uses this to find work
   * to run; the ORDER makes execution deterministic when several are queued.
   */
  listApproved(projectId: string, actionType: ApprovalActionType): ApprovalRequest[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM approval_requests
         WHERE project_id = ? AND action_type = ? AND status = 'approved'
         ORDER BY created_at ASC`,
      )
      .all(projectId, actionType) as ApprovalRow[]
    return rows.map((r) => this.toRequest(r))
  }

  list(projectId: string, limit = 50): ApprovalRequest[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM approval_requests WHERE project_id = ? ORDER BY
         CASE status WHEN 'pending' THEN 0 ELSE 1 END, created_at DESC LIMIT ?`,
      )
      .all(projectId, limit) as ApprovalRow[]
    return rows.map((r) => this.toRequest(r))
  }

  countPending(projectId: string): number {
    const row = this.db
      .prepare(`SELECT COUNT(*) as n FROM approval_requests WHERE project_id = ? AND status = 'pending'`)
      .get(projectId) as { n: number }
    return row.n
  }

  private toRequest(row: ApprovalRow): ApprovalRequest {
    return {
      id: row.id,
      projectId: row.project_id,
      actionType: row.action_type as ApprovalActionType,
      riskLevel: row.risk_level as ApprovalRequest['riskLevel'],
      summary: row.summary,
      payload: safeJson<Record<string, unknown>>(row.command_or_payload_json, {}),
      status: row.status as ApprovalStatus,
      createdAt: row.created_at,
      resolvedAt: row.resolved_at,
    }
  }
}
