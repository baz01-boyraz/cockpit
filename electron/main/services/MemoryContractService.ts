import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  upsertAgentsMdContract,
  upsertClaudeSettingsHooks,
} from '@shared/memory-contract'
import type { AuditLogService } from './AuditLogService'
import type { ProjectService } from './ProjectService'

/**
 * Provisions the standing memory-first contract before an agent terminal
 * starts, through each engine's native channel: a UserPromptSubmit hook for
 * Claude Code, a managed AGENTS.md block for Codex. The user's prompts are
 * never modified — the CLI itself carries the contract. Provisioning is
 * idempotent; a launch may not proceed when the contract cannot be
 * guaranteed (MUST semantics), so unrecoverable states throw.
 */
export class MemoryContractService {
  constructor(
    private readonly projects: Pick<ProjectService, 'get'>,
    private readonly audit?: Pick<AuditLogService, 'record'>,
  ) {}

  ensureForAgent(projectId: string, agent: 'claude' | 'codex'): void {
    const projectPath = this.projects.get(projectId).path
    const provisioned =
      agent === 'claude'
        ? this.ensureClaudeHook(projectPath)
        : this.ensureAgentsMd(projectPath)
    if (!provisioned) return
    try {
      this.audit?.record({
        projectId,
        actor: 'system',
        actionType: 'memory.contract_provisioned',
        summary: `Memory-first contract provisioned for ${agent} (${provisioned})`,
        payload: { agent, target: provisioned },
      })
    } catch {
      // The contract is already on disk; audit storage being down cannot revoke it.
    }
  }

  /** Returns the repo-relative target when a write happened, null when already current. */
  private ensureClaudeHook(projectPath: string): string | null {
    const dir = join(projectPath, '.claude')
    const file = join(dir, 'settings.local.json')
    const raw = existsSync(file) ? readFileSync(file, 'utf8') : null
    const next = upsertClaudeSettingsHooks(raw)
    if (next === null) {
      throw new Error(
        `Cannot guarantee the memory contract: ${file} is not valid JSON. ` +
          'Fix or remove the file, then launch the agent again.',
      )
    }
    if (next === raw) return null
    mkdirSync(dir, { recursive: true })
    writeFileSync(file, next, 'utf8')
    return '.claude/settings.local.json'
  }

  private ensureAgentsMd(projectPath: string): string | null {
    const file = join(projectPath, 'AGENTS.md')
    const raw = existsSync(file) ? readFileSync(file, 'utf8') : null
    const next = upsertAgentsMdContract(raw)
    if (next === raw) return null
    writeFileSync(file, next, 'utf8')
    return 'AGENTS.md'
  }
}
