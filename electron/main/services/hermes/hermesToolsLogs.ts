import { projectIdSchema } from '@shared/schemas'
import type { HermesTool, HermesToolContext } from './hermesToolTypes'

/**
 * Read-only log/error intelligence for Hermes' git/log stewardship (Faz 6).
 * Wraps the exact `LogIntelligenceService` methods the Log panel's IPC path
 * uses — same project-id schema, no new log-processing logic, no write path.
 * This is what lets the daily-steward flow notice a recurring failure before
 * deciding whether it is worth a `propose_swarm_card`.
 */
export function createLogTools(ctx: HermesToolContext): HermesTool[] {
  return [
    {
      name: 'get_log_intelligence',
      description:
        "Read the project's captured logs and aggregated error insights (both read-only, redacted). Returns `{ logs, insights }` — recent warn/error log lines plus the deduped, still-live error insights the Dashboard surfaces. Use this to spot recurring failures worth proposing a fix for; it never modifies anything.",
      inputShape: projectIdSchema.shape,
      run: async (raw) => {
        const { projectId } = projectIdSchema.parse(raw)
        return {
          logs: ctx.logs.listLogs(projectId),
          insights: ctx.logs.listInsights(projectId),
        }
      },
    },
  ]
}
