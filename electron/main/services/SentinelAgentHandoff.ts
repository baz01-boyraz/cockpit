import {
  buildSignalInvestigationPrompt,
  signalImportance,
  signalRestartImpact,
} from '@shared/sentinel'
import type { TerminalSession } from '@shared/domain'
import type { AuditLogService } from './AuditLogService'
import type { MemoryContractService } from './MemoryContractService'
import type { SentinelService } from './SentinelService'
import type { TerminalManager } from './TerminalManager'

export interface SentinelAgentHandoffInput {
  projectId: string
  signalId: string
  agent: 'claude' | 'codex'
}

interface SentinelAgentHandoffDependencies {
  signals: Pick<SentinelService, 'get' | 'markSeen'>
  contracts: Pick<MemoryContractService, 'ensureForAgent'>
  terminals: Pick<TerminalManager, 'launchAgent'>
  audit: Pick<AuditLogService, 'record'>
}

/**
 * Explicit owner-click handoff from a persisted signal to a direct terminal.
 * The service never fixes, publishes, or restarts anything itself: it opens the
 * requested agent with bounded evidence, clears unseen pressure, and leaves an
 * audit record after the terminal exists.
 */
export class SentinelAgentHandoff {
  constructor(private readonly deps: SentinelAgentHandoffDependencies) {}

  ask(input: SentinelAgentHandoffInput): TerminalSession {
    const signal = this.deps.signals.get(input.projectId, input.signalId)
    if (!signal) throw new Error('Signal was not found in this project.')

    const prompt = buildSignalInvestigationPrompt(signal)
    this.deps.contracts.ensureForAgent(input.projectId, input.agent)
    const session = this.deps.terminals.launchAgent(input.projectId, input.agent, prompt)
    this.deps.signals.markSeen(input.projectId, [signal.id])
    this.deps.audit.record({
      projectId: input.projectId,
      actor: 'user',
      actionType: 'sentinel.ask_agent',
      summary: `Opened ${input.agent === 'claude' ? 'Claude' : 'Codex'} to inspect “${signal.title}”`,
      payload: {
        signalId: signal.id,
        agent: input.agent,
        importance: signalImportance(signal),
        restartImpact: signalRestartImpact(signal).state,
      },
    })
    return session
  }
}
