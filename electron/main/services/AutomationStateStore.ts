import {
  AUTOMATION_POLICY,
  dailyDigestId,
  nextAutomationRun,
  type AutomationCreateInput,
  type AutomationJob,
  type AutomationSchedule,
} from '@shared/automation'
import type { Db } from '../db/Database'
import { newId } from '../util/ids'

interface AutomationRow {
  id: string
  project_id: string
  name: string
  instruction: string
  kind: string
  schedule_json: string
  system: number
  enabled: number
  state: string
  next_run_at: string
  last_run_at: string | null
  last_status: string
  last_result: string | null
  last_error: string | null
  created_at: string
  updated_at: string
}

export interface AutomationFinishInput {
  at: string
  nextRunAt: string
  result: string
}

export interface AutomationFailureInput {
  at: string
  nextRunAt: string
  error: string
}

export interface AutomationRepository {
  ensureDailyDigest(projectId: string, at: string): void
  list(projectId: string): AutomationJob[]
  due(at: string, limit?: number): AutomationJob[]
  create(input: AutomationCreateInput, at: string): AutomationJob
  claim(projectId: string, id: string, at: string, force: boolean): AutomationJob | null
  complete(projectId: string, id: string, input: AutomationFinishInput): AutomationJob
  fail(projectId: string, id: string, input: AutomationFailureInput): AutomationJob
  setEnabled(projectId: string, id: string, enabled: boolean, at: string): AutomationJob | null
  remove(projectId: string, id: string): boolean
}

const parseSchedule = (raw: string): AutomationSchedule => {
  try {
    const parsed = JSON.parse(raw) as AutomationSchedule
    if (parsed.kind === 'daily' && typeof parsed.time === 'string') return parsed
    if (parsed.kind === 'interval' && Number.isFinite(parsed.minutes)) return parsed
  } catch {
    // Fall through to the safe daily default.
  }
  return { kind: 'daily', time: '09:00' }
}

const staleBefore = (at: string): string =>
  new Date(Date.parse(at) - AUTOMATION_POLICY.staleRunMs).toISOString()

export class AutomationStateStore implements AutomationRepository {
  constructor(private readonly db: Db) {}

  ensureDailyDigest(projectId: string, at: string): void {
    const schedule: AutomationSchedule = { kind: 'daily', time: '09:00' }
    this.db
      .prepare(
        `INSERT OR IGNORE INTO automation_jobs
          (id, project_id, name, instruction, kind, schedule_json, system, enabled, state,
           next_run_at, last_run_at, last_status, last_result, last_error, created_at, updated_at)
         VALUES
          (@id, @projectId, @name, @instruction, @kind, @scheduleJson, 1, 1, 'scheduled',
           @nextRunAt, NULL, 'never', NULL, NULL, @at, @at)`,
      )
      .run({
        id: dailyDigestId(projectId),
        projectId,
        name: 'Daily briefing',
        instruction: 'Give me a concise daily manager briefing from the deterministic project health snapshot.',
        kind: 'digest',
        scheduleJson: JSON.stringify(schedule),
        nextRunAt: nextAutomationRun(schedule, at),
        at,
      })
  }

  list(projectId: string): AutomationJob[] {
    const rows = this.db
      .prepare('SELECT * FROM automation_jobs WHERE project_id = ? ORDER BY system DESC, created_at ASC')
      .all(projectId) as AutomationRow[]
    return rows.map((row) => this.toJob(row))
  }

  due(at: string, limit = 20): AutomationJob[] {
    const bounded = Math.max(1, Math.min(50, Math.floor(limit)))
    const rows = this.db
      .prepare(
        `SELECT * FROM automation_jobs
         WHERE enabled = 1 AND state = 'scheduled' AND next_run_at <= ?
         ORDER BY next_run_at ASC LIMIT ?`,
      )
      .all(at, bounded) as AutomationRow[]
    return rows.map((row) => this.toJob(row))
  }

  create(input: AutomationCreateInput, at: string): AutomationJob {
    const count = this.db
      .prepare('SELECT COUNT(*) AS count FROM automation_jobs WHERE project_id = ?')
      .get(input.projectId) as { count: number } | undefined
    if ((count?.count ?? 0) >= AUTOMATION_POLICY.maxJobsPerProject) {
      throw new Error(`Automation limit reached (${AUTOMATION_POLICY.maxJobsPerProject} per project).`)
    }
    const id = newId('auto')
    this.db
      .prepare(
        `INSERT INTO automation_jobs
          (id, project_id, name, instruction, kind, schedule_json, system, enabled, state,
           next_run_at, last_run_at, last_status, last_result, last_error, created_at, updated_at)
         VALUES
          (@id, @projectId, @name, @instruction, 'watch', @scheduleJson, 0, 1, 'scheduled',
           @nextRunAt, NULL, 'never', NULL, NULL, @at, @at)`,
      )
      .run({
        id,
        projectId: input.projectId,
        name: input.name.trim(),
        instruction: input.instruction.trim(),
        scheduleJson: JSON.stringify(input.schedule),
        nextRunAt: nextAutomationRun(input.schedule, at),
        at,
      })
    return this.get(input.projectId, id)!
  }

  claim(projectId: string, id: string, at: string, force: boolean): AutomationJob | null {
    const result = this.db
      .prepare(
        `UPDATE automation_jobs SET state = 'running', last_status = 'running', updated_at = @at
         WHERE id = @id AND project_id = @projectId AND enabled = 1
           AND (@force = 1 OR next_run_at <= @at)
           AND (state != 'running' OR updated_at <= @staleBefore)`,
      )
      .run({ projectId, id, at, force: force ? 1 : 0, staleBefore: staleBefore(at) })
    if (result.changes !== 1) return null
    return this.get(projectId, id)
  }

  complete(projectId: string, id: string, input: AutomationFinishInput): AutomationJob {
    this.db
      .prepare(
        `UPDATE automation_jobs SET state = 'scheduled', last_run_at = @at, last_status = @status,
           last_result = @result, last_error = NULL, next_run_at = @nextRunAt, updated_at = @at
         WHERE id = @id AND project_id = @projectId`,
      )
      .run({ projectId, id, status: 'ok', ...input })
    return this.required(projectId, id)
  }

  fail(projectId: string, id: string, input: AutomationFailureInput): AutomationJob {
    this.db
      .prepare(
        `UPDATE automation_jobs SET state = 'scheduled', last_run_at = @at, last_status = 'error',
           last_result = NULL, last_error = @error, next_run_at = @nextRunAt, updated_at = @at
         WHERE id = @id AND project_id = @projectId`,
      )
      .run({ projectId, id, ...input })
    return this.required(projectId, id)
  }

  setEnabled(projectId: string, id: string, enabled: boolean, at: string): AutomationJob | null {
    const current = this.get(projectId, id)
    if (!current || current.state === 'running') return null
    const nextRunAt = enabled ? nextAutomationRun(current.schedule, at) : current.nextRunAt
    const result = this.db
      .prepare(
        `UPDATE automation_jobs SET enabled = @enabled, state = @state,
           next_run_at = @nextRunAt, updated_at = @at
         WHERE id = @id AND project_id = @projectId AND state != 'running'`,
      )
      .run({
        projectId,
        id,
        enabled: enabled ? 1 : 0,
        state: enabled ? 'scheduled' : 'paused',
        nextRunAt,
        at,
      })
    if (result.changes !== 1) return null
    return this.get(projectId, id)
  }

  remove(projectId: string, id: string): boolean {
    return this.db
      .prepare(
        `DELETE FROM automation_jobs
         WHERE id = ? AND project_id = ? AND system = 0 AND state != 'running'`,
      )
      .run(id, projectId).changes === 1
  }

  private get(projectId: string, id: string): AutomationJob | null {
    const row = this.db
      .prepare('SELECT * FROM automation_jobs WHERE id = ? AND project_id = ?')
      .get(id, projectId) as AutomationRow | undefined
    return row ? this.toJob(row) : null
  }

  private required(projectId: string, id: string): AutomationJob {
    const job = this.get(projectId, id)
    if (!job) throw new Error('Automation disappeared while updating its lifecycle.')
    return job
  }

  private toJob(row: AutomationRow): AutomationJob {
    const state = row.state === 'running' || row.state === 'paused' ? row.state : 'scheduled'
    const status = ['never', 'running', 'ok', 'error'].includes(row.last_status)
      ? row.last_status as AutomationJob['lastStatus']
      : 'never'
    return {
      id: row.id,
      projectId: row.project_id,
      name: row.name,
      instruction: row.instruction,
      kind: row.kind === 'digest' ? 'digest' : 'watch',
      schedule: parseSchedule(row.schedule_json),
      system: row.system === 1,
      enabled: row.enabled === 1,
      state,
      nextRunAt: row.next_run_at,
      lastRunAt: row.last_run_at,
      lastStatus: status,
      lastResult: row.last_result,
      lastError: row.last_error,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }
  }
}
