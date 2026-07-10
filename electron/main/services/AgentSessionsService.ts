import type { ResumableSessionSummary } from '@shared/domain'
import { ClaudeSessionsService } from './ClaudeSessionsService'
import { CodexSessionsService } from './CodexSessionsService'

const MAX_SESSIONS = 40

export function mergeResumableSessions(
  sessions: readonly ResumableSessionSummary[],
): ResumableSessionSummary[] {
  return [...sessions]
    .sort((a, b) => b.lastActiveAt.localeCompare(a.lastActiveAt))
    .slice(0, MAX_SESSIONS)
}

/** Unified read model for the Resume picker; Claude-only memory capture remains separate. */
export class AgentSessionsService {
  constructor(
    private readonly claude = new ClaudeSessionsService(),
    private readonly codex = new CodexSessionsService(),
  ) {}

  list(projectPath: string): ResumableSessionSummary[] {
    const claude = this.claude.list(projectPath).map(
      (session): ResumableSessionSummary => ({ ...session, provider: 'claude' }),
    )
    return mergeResumableSessions([...claude, ...this.codex.list(projectPath)])
  }
}
