import type { z } from 'zod'
import type { SwarmService } from '../SwarmService'
import type { CouncilService } from '../CouncilService'
import type { AgentUsageService } from '../AgentUsageService'
import type { GitService } from '../GitService'
import type { ReviewService } from '../ReviewService'
import type { MemoryHubService } from '../MemoryHubService'
import type { MemoryReviewService } from '../MemoryReviewService'
import type { MemoryPipeline } from '../MemoryPipeline'
import type { MemoryCurationService } from '../MemoryCurationService'
import type { MemoryPolicyService } from '../MemoryPolicyService'
import type { ApprovalService } from '../ApprovalService'
import type { AuditLogService } from '../AuditLogService'
import type { LogIntelligenceService } from '../LogIntelligenceService'
import type { CardOutputTracker } from './CardOutputTracker'
import type { HermesChecksService } from './HermesChecksService'
import type { AppScreenshotService } from './AppScreenshotService'

/**
 * The narrow slice of the app the Hermes MCP tools may touch. Each field is a
 * `Pick` of a real service so the concrete `Services` instance satisfies it
 * structurally — the tools call the SAME in-process methods the renderer's IPC
 * handlers call, never a shell or the filesystem. Widening this is the ONLY way
 * Hermes gains a new capability, which is exactly why it is spelled out here.
 */
export interface HermesToolContext {
  // Faz 3a — swarm + usage (Faz 2.5 adds the on-demand completion report)
  swarm: Pick<SwarmService, 'createCard' | 'updateCard' | 'startCard' | 'board' | 'completionReport'>
  // Faz 3 (council) — spec gate before a card is created/proposed.
  council: Pick<CouncilService, 'run' | 'scorecard'>
  agentUsage: Pick<AgentUsageService, 'getReport'>
  cardOutput: Pick<CardOutputTracker, 'track' | 'drain' | 'untrack'>
  // Faz 3b — git (read-only), checks (allowlist-only), screenshot, memory
  git: Pick<GitService, 'status' | 'headCommit'>
  review: Pick<ReviewService, 'diffStat'>
  checks: Pick<HermesChecksService, 'run'>
  screenshot: Pick<AppScreenshotService, 'capture'>
  memory: Pick<MemoryHubService, 'list' | 'listDocs' | 'write'>
  // `create` lets the charter write-gate (Faz C) route a junk/unjustified write
  // into the SAME review queue the distiller uses, instead of persisting it.
  memoryReviews: Pick<MemoryReviewService, 'listPendingFor' | 'create'>
  memoryPolicy: Pick<MemoryPolicyService, 'getTrustMode'>
  memoryPipeline: Pick<MemoryPipeline, 'resolveReview'>
  // Faz D — the weekly memory curation sweep. `run_memory_sweep` triggers it;
  // proposals land in the review queue above, never a direct file operation.
  memoryCuration: Pick<MemoryCurationService, 'sweep'>
  // Optional: gate outcomes (accept/review/reject counts, no content) are
  // recorded here for the junk-rate metric when an audit sink is wired.
  audit?: Pick<AuditLogService, 'record'>
  // Faz 6 — git/log stewardship
  logs: Pick<LogIntelligenceService, 'listLogs' | 'listInsights'>
  // `propose_swarm_card` only ever REQUESTS an approval — it can never open a
  // card itself (that path is the HermesApprovalExecutor, post human-approval).
  approvals: Pick<ApprovalService, 'request'>
}

/**
 * A transport-independent tool definition. `inputShape` is the Zod raw shape the
 * MCP layer advertises and validates against; `run` re-parses the raw input with
 * the canonical schema (defence in depth — MCP input is untrusted) and calls the
 * underlying service. Keeping this free of any MCP/HTTP types is what lets the
 * tests exercise every tool by calling `run` directly.
 */
export interface HermesTool {
  readonly name: string
  readonly description: string
  readonly inputShape: z.ZodRawShape
  run(rawInput: unknown): Promise<unknown>
}
