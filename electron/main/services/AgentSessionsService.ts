import type { CapturableSessionSummary, ResumableSessionSummary } from '@shared/domain'
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

/** Unified provider model for both the Resume picker and memory capture. */
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

  /** Main-process-only capture candidates with provider-native source paths. */
  captureList(projectPath: string): CapturableSessionSummary[] {
    const claude = this.claude.list(projectPath).map(
      (session): CapturableSessionSummary => ({
        ...session,
        provider: 'claude',
        transcriptPath: this.claude.transcriptPath(projectPath, session.id),
      }),
    )
    return [...claude, ...this.codex.captureList(projectPath)]
      .sort((a, b) => b.lastActiveAt.localeCompare(a.lastActiveAt))
      .slice(0, MAX_SESSIONS)
  }
}
