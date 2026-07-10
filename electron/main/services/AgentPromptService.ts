import {
  wrapTaskWithMemory,
  type MemoryContextProvider,
  type PreparedAgentPrompt,
} from '@shared/memory-context'
import type { TerminalSession } from '@shared/domain'

type TerminalLookup = {
  get(sessionId: string): Pick<TerminalSession, 'id' | 'projectId' | 'role'> | null
}

/** Official Claude/Codex terminal task ingress — always memory-backed. */
export class AgentPromptService {
  constructor(
    private readonly terminals: TerminalLookup,
    private readonly memoryContexts: MemoryContextProvider,
  ) {}

  prepare(sessionId: string, prompt: string): PreparedAgentPrompt {
    const session = this.terminals.get(sessionId)
    if (!session) throw new Error('Terminal session not found.')
    if (session.role !== 'claude' && session.role !== 'codex') {
      throw new Error('Memory-backed task prompts can only be sent to a Claude or Codex terminal.')
    }
    const query = prompt.trim()
    if (!query) throw new Error('Task prompt cannot be empty.')
    const context = this.memoryContexts.forTask({
      projectId: session.projectId,
      surface: session.role === 'claude' ? 'terminal_claude' : 'terminal_codex',
      query,
    })
    return {
      prompt: wrapTaskWithMemory(query, context),
      memory: context.receipt,
    }
  }
}
