/**
 * Zod schemas for validating data crossing trust boundaries:
 *   - the on-disk `.dev-cockpit/project.json` config
 *   - IPC request payloads coming from the renderer
 *
 * Never trust external data. Every IPC handler validates its input with one of
 * these schemas before touching the filesystem, git, or a child process.
 */
import { z } from 'zod'
import { ROLE_IDS, SPEC_IDS, type Role, type Spec } from './agent-taxonomy'
import { SENTINEL_OUTCOMES } from './sentinel'
import { MEMORY_BRAIN_SCOPES, MEMORY_TRUST_MODES } from './memory-policy'

export const approvalActionTypeSchema = z.enum([
  'git_push',
  'git_force_push',
  'deploy',
  'redeploy',
  'restart_service',
  'delete_file',
  'database_reset',
  'env_write',
  'shell_command',
])

export const terminalRoleSchema = z.enum([
  'frontend',
  'backend',
  'claude',
  'codex',
  'git',
  'general',
])

export const terminalProfileSchema = z.object({
  name: z.string().min(1).max(64),
  cwd: z.string().default('.'),
  command: z.string().nullable().optional(),
  role: terminalRoleSchema.nullable().optional(),
})

export const terminalLayoutSlotSchema = z.object({
  sessionId: z.string(),
  column: z.number().int(),
  row: z.number().int(),
})

export const projectConfigSchema = z.object({
  version: z.number().int().positive(),
  project: z.object({
    name: z.string().min(1).max(120),
    path: z.string().min(1),
    techStack: z.array(z.string()).default([]),
  }),
  terminals: z
    .object({
      max: z.number().int().min(1).max(6).default(6),
      layout: z.array(terminalLayoutSlotSchema).default([]),
      profiles: z.array(terminalProfileSchema).default([]),
    })
    .default({ max: 6, layout: [], profiles: [] }),
  railway: z
    .object({
      projectId: z.string().nullable().default(null),
      environmentId: z.string().nullable().default(null),
      services: z.array(z.string()).default([]),
    })
    .default({ projectId: null, environmentId: null, services: [] }),
  safety: z
    .object({
      requireApprovalFor: z.array(approvalActionTypeSchema).default([
        'git_push',
        'git_force_push',
        'deploy',
        'redeploy',
        'restart_service',
        'delete_file',
        'database_reset',
        'env_write',
      ]),
    })
    .default({
      requireApprovalFor: [
        'git_push',
        'git_force_push',
        'deploy',
        'redeploy',
        'restart_service',
        'delete_file',
        'database_reset',
        'env_write',
      ],
    }),
})

export type ProjectConfigInput = z.input<typeof projectConfigSchema>
export type ProjectConfigParsed = z.output<typeof projectConfigSchema>

// --- IPC request payloads -------------------------------------------------

export const addProjectInputSchema = z.object({
  path: z.string().min(1),
  name: z.string().min(1).max(120).optional(),
})

export const projectIdSchema = z.object({ projectId: z.string().min(1) })

export const createTerminalInputSchema = z.object({
  projectId: z.string().min(1),
  name: z.string().min(1).max(64).optional(),
  role: terminalRoleSchema.nullable().optional(),
  cwd: z.string().optional(),
  command: z.string().nullable().optional(),
})

export const terminalIdSchema = z.object({ sessionId: z.string().min(1) })

export const terminalInputSchema = z.object({
  sessionId: z.string().min(1),
  data: z.string(),
})

export const terminalAttachmentInputSchema = z.object({
  projectId: z.string().min(1),
  sessionId: z.string().min(1).nullable().optional(),
  fileName: z.string().min(1).max(180),
  mimeType: z.enum(['image/png', 'image/jpeg', 'image/webp', 'image/gif']),
  dataBase64: z.string().min(1).max(14_000_000).regex(/^[A-Za-z0-9+/=]+$/),
})

export const terminalResizeSchema = z.object({
  sessionId: z.string().min(1),
  cols: z.number().int().min(1).max(1000),
  rows: z.number().int().min(1).max(1000),
})

export const terminalRenameSchema = z.object({
  sessionId: z.string().min(1),
  name: z.string().min(1).max(64),
  role: terminalRoleSchema.nullable().optional(),
  alias: z.string().max(48).nullable().optional(),
})

/**
 * The Claude session id is interpolated into a `claude --resume <id>` shell
 * command, so it must be a strict UUID — never free-form text — to keep shell
 * metacharacters out of the command.
 */
export const resumeClaudeSchema = z.object({
  projectId: z.string().min(1),
  sessionId: z.string().regex(/^[0-9a-fA-F-]{36}$/),
})

export const resumeAgentSchema = resumeClaudeSchema.extend({
  provider: z.enum(['claude', 'codex']),
})

export const routeQuerySchema = z.object({
  projectId: z.string().min(1),
  query: z.string().min(1).max(4000),
})

export const chatAskSchema = z.object({
  projectId: z.string().min(1),
  prompt: z.string().min(1).max(16000),
  opts: z
    .object({
      model: z.string().min(1).max(120).optional(),
    })
    .optional(),
})

export const reviewDiffStatSchema = z.object({
  projectId: z.string().min(1),
  // Absolute path of a swarm worktree; main re-validates it sits inside the project.
  dir: z.string().min(1).max(1024).optional(),
})

export const councilRunSchema = z.object({
  projectId: z.string().min(1),
  model: z.string().min(1).max(120).optional(),
  // Explicit intent; analysis is grounded by the bounded main-process collector.
  mode: z.enum(['diff', 'spec', 'analysis']).optional(),
  // Absolute path of a swarm worktree; main re-validates it sits inside the project.
  dir: z.string().min(1).max(1024).optional(),
  // The card's own title/body — the author's stated intent, grounds the seats.
  question: z.string().max(4000).optional(),
  // Spec-mode input: a draft task spec (markdown/plain), fenced as UNTRUSTED by main.
  spec: z.string().max(16_000).optional(),
  // The card a spec-gate run belongs to — kept as session history, no card FK.
  cardId: z.string().max(200).optional(),
  // BCP-47-ish override. Human prose follows this; machine labels remain English.
  responseLanguage: z
    .string()
    .min(2)
    .max(32)
    .regex(/^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/i)
    .optional(),
  analysisEgress: z
    .enum(['local-only', 'account-models', 'all-configured'])
    .optional(),
  analysisConsent: z.boolean().optional(),
  // Renderer-generated correlation id for progress events; never a DB/session id.
  clientRunId: z.string().min(1).max(120).regex(/^[a-zA-Z0-9._:-]+$/).optional(),
}).superRefine((value, ctx) => {
  const hasAnalysisPolicy = value.analysisEgress !== undefined || value.analysisConsent !== undefined
  if (value.mode !== 'analysis' && hasAnalysisPolicy) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['analysisEgress'],
      message: 'Analysis data-sharing fields require analysis mode.',
    })
    return
  }
  if (value.mode !== 'analysis') return
  const remote =
    value.analysisEgress === 'account-models' || value.analysisEgress === 'all-configured'
  if (remote && value.analysisConsent !== true) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['analysisConsent'],
      message: 'Remote repository analysis requires explicit consent.',
    })
  }
  if (!remote && value.analysisConsent === true) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['analysisConsent'],
      message: 'Local-only analysis cannot record remote-data consent.',
    })
  }
})

export const memoryNameSchema = z.object({
  projectId: z.string().min(1),
  name: z.string().min(1).max(120),
})

export const memoryWriteSchema = z.object({
  projectId: z.string().min(1),
  name: z.string().min(1).max(120),
  content: z.string().max(500_000),
})

export const memoryRenameSchema = z.object({
  projectId: z.string().min(1),
  from: z.string().min(1).max(120),
  to: z.string().min(1).max(120),
})

/** Provider-native transcript ids — no path characters or renderer-supplied paths. */
export const memoryCaptureSchema = z.object({
  projectId: z.string().min(1),
  provider: z.enum(['claude', 'codex']),
  sessionId: z.string().min(1).max(200).regex(/^[A-Za-z0-9._-]+$/, 'invalid session id'),
  dryRun: z.boolean().optional(),
})

export const memoryCaptureRetrySchema = z.object({
  projectId: z.string().min(1),
  jobId: z.string().min(1).max(200),
})

export const memoryBrainScopeSchema = z.enum(MEMORY_BRAIN_SCOPES)

/** Every review/policy request names its origin project and explicit target scope. */
export const memoryBrainAccessSchema = z.object({
  projectId: z.string().min(1),
  scope: memoryBrainScopeSchema,
})

export const memorySetTrustModeSchema = memoryBrainAccessSchema.extend({
  mode: z.enum(MEMORY_TRUST_MODES),
})

export const memoryResolveReviewSchema = memoryBrainAccessSchema.extend({
  reviewId: z.string().min(1).max(200),
  decision: z.enum(['accept', 'edit', 'discard']),
  editedContent: z.string().max(500_000).optional(),
})

export const memoryLedgerSchema = z.object({
  projectId: z.string().min(1),
  noteSlug: z.string().min(1).max(120).optional(),
})

/** A note can live in the current project brain or the cross-project Baz brain. */
export const memoryNoteActivitySchema = z.object({
  projectId: z.string().min(1),
  noteSlug: z.string().min(1).max(120),
  scope: memoryBrainScopeSchema.default('project'),
})

export const memorySnapshotSchema = z.object({
  projectId: z.string().min(1),
  snapshotId: z.string().min(1).max(160).regex(/^[0-9A-Za-z.-]+-[a-f0-9]{8}$/),
})

export const memoryBazReadSchema = z.object({
  name: z.string().min(1).max(120),
})

// --- sentinel signals (Faz A: always-on, LLM-free signal layer) -----------
//
// Read-only surface for the renderer: list the feed, mark seen, count unseen.
// Signals are PRODUCED in main by sensors, never by the renderer — there is no
// "report" channel here. `ids` is capped so a mark-seen call can never fan out
// unboundedly.
export const sentinelListSchema = z.object({
  projectId: z.string().min(1),
  limit: z.number().int().min(1).max(200).optional(),
})

export const sentinelMarkSeenSchema = z.object({
  projectId: z.string().min(1),
  ids: z.array(z.string().min(1).max(200)).max(200),
})

export const sentinelUnseenCountSchema = z.object({
  projectId: z.string().min(1),
})

// The user's response to a signal (Track G3). `outcome` is the closed vocabulary
// from shared/sentinel.ts — enum-validated so a renderer can never write a
// non-vocabulary string onto the row. Project-scoped in the handler.
export const sentinelRecordOutcomeSchema = z.object({
  projectId: z.string().min(1),
  id: z.string().min(1).max(200),
  outcome: z.enum(SENTINEL_OUTCOMES),
})

// Track H1: turn a signal into a Swarm card. Only the ids cross the boundary —
// main reads the signal's own (already-redacted) fields to compose the card, so
// the renderer never supplies card text here. Project-scoped in the handler.
export const sentinelCreateCardSchema = z.object({
  projectId: z.string().min(1),
  signalId: z.string().min(1).max(200),
})

// --- secret store (encrypted, OS-keychain backed) -------------------------
//
// The kind is a closed enum, not a bare string: it is a trust boundary. Each
// kind maps to a fixed storage ref in the main process. The value is stored
// encrypted and NEVER crosses back to the renderer (there is deliberately no
// `secretGet` channel) — the renderer can only set, probe existence, or delete.
export const SECRET_KINDS = ['openrouter'] as const
export type SecretKind = (typeof SECRET_KINDS)[number]

export const secretKindSchema = z.enum(SECRET_KINDS)

export const secretSetSchema = z.object({
  kind: secretKindSchema,
  value: z.string().min(1).max(500),
})

export const secretKindOnlySchema = z.object({
  kind: secretKindSchema,
})

export const swarmProjectSchema = z.object({
  projectId: z.string().min(1),
})

export const swarmCreateCardSchema = z.object({
  projectId: z.string().min(1),
  title: z.string().min(1).max(200),
  body: z.string().max(20_000).optional(),
  /** An approved council session that shaped this card (Faz 2a); history, no FK. */
  councilSessionId: z.string().max(200).nullable().optional(),
})

/** One role/spec assignment — ids validated against the taxonomy catalog. */
export const assignmentSchema = z.object({
  role: z.enum(ROLE_IDS as [Role, ...Role[]]),
  spec: z.enum(SPEC_IDS as [Spec, ...Spec[]]).nullable().optional(),
})

export const swarmUpdateCardSchema = z.object({
  projectId: z.string().min(1),
  cardId: z.string().min(1),
  title: z.string().min(1).max(200).optional(),
  body: z.string().max(20_000).optional(),
  role: z.string().min(1).max(60).nullable().optional(),
  persona: z.string().min(1).max(60).nullable().optional(),
  agent: z.string().min(1).max(60).nullable().optional(),
  /** Ordered role pipeline; capped so a card can never fan out unboundedly. */
  assignments: z.array(assignmentSchema).max(6).optional(),
  /** Link/clear the card's approved council session (Faz 2a); history, no FK. */
  councilSessionId: z.string().max(200).nullable().optional(),
})

// --- council scorecard (Faz 2a) -------------------------------------------
//
// Cross-session seat standings for a project — the read side of the persisted
// council history. Input is just the project id; the merge math is the pure
// `computeScorecard` in shared/council.
export const councilScorecardSchema = z.object({
  projectId: z.string().min(1),
})

// Recent persisted sessions for a project — the read side of council history
// (E4). Input is just the project id; the store's defensive parse + the
// service's content-free projection do the rest.
export const councilSessionsSchema = z.object({
  projectId: z.string().min(1),
})

// Detail read for ONE persisted session — the full CouncilResult behind a
// `council:sessions` header. Project-scoped in main (a foreign session reads
// back null); the id is a store UUID, so no path characters are allowed.
export const councilSessionSchema = z.object({
  projectId: z.string().min(1),
  sessionId: z.string().min(1).max(200),
})

// --- outcome scorecard (Track G4) -----------------------------------------
//
// The read-only judgment scorecard. Input is just the project id; the aggregation
// is pure (`shared/outcomes`) over the append-only audit trail + read models.
export const outcomesScorecardSchema = z.object({
  projectId: z.string().min(1),
})

// The subset stashed in the approval request's payload — what the executor reads
// back and re-validates before opening the card (the stored payload is untrusted
// input like anything crossing a boundary: it has been through redaction on disk).
export const proposedSwarmCardPayloadSchema = z.object({
  title: z.string().min(1).max(200),
  body: z.string().max(20_000).optional(),
  assignments: z.array(assignmentSchema).max(6).optional(),
  /** Persisted onto the opened card so a self-initiated proposal keeps its
   *  council provenance the same way a human-created card does. */
  councilSessionId: z.string().max(200).nullable().optional(),
})

// The renderer is always the "user" actor: schema-level status choices exclude
// in_progress, so a drag can never even *ask* for a service-owned transition.
export const swarmMoveCardSchema = z.object({
  projectId: z.string().min(1),
  cardId: z.string().min(1),
  to: z.enum(['todo', 'in_review', 'done', 'parked']),
  index: z.number().int().min(0).max(10_000),
})

export const swarmRemoveCardSchema = z.object({
  projectId: z.string().min(1),
  cardId: z.string().min(1),
})

// Start extends the {projectId, cardId} pair with the council spec-gate escape:
// `skipGate` lets the developer start a card whose spec the council hasn't
// approved (an explicit, audited override). Absent/false → the gate is enforced.
export const swarmStartCardSchema = swarmRemoveCardSchema.extend({
  skipGate: z.boolean().optional(),
  /** Explicit renderer-side proof that the user clicked Start in Swarm. */
  userOrigin: z.literal('swarm-panel'),
})

// A completion report / a card-output tail take the same {projectId, cardId}
// pair — aliased rather than re-declared, keeping one source of truth.
export const swarmCompletionReportSchema = swarmRemoveCardSchema

export const gitDiffInputSchema = z.object({
  projectId: z.string().min(1),
  path: z.string().min(1),
  staged: z.boolean().optional(),
})

export const gitStageInputSchema = z
  .object({
    projectId: z.string().min(1),
    paths: z.array(z.string().min(1)).optional(),
    all: z.boolean().optional(),
  })
  .refine((v) => v.all || (v.paths && v.paths.length > 0), {
    message: 'Provide paths or set all=true',
  })

export const gitCommitInputSchema = z.object({
  projectId: z.string().min(1),
  message: z.string().min(1).max(240),
})

/**
 * A regular push is the one enabled write path (non-destructive, audit-logged).
 * Force-push can rewrite remote history, so it must carry the id of an
 * approved request — the main process verifies and consumes it before
 * executing. The schema makes "force without approval" unrepresentable.
 */
export const gitPushInputSchema = z
  .object({
    projectId: z.string().min(1),
    force: z.boolean().optional(),
    approvalId: z.string().min(1).optional(),
  })
  .refine((v) => !v.force || Boolean(v.approvalId), {
    message: 'Force-push requires an approved request — request approval first.',
  })

/** Matches GitHub's own repository name character set. */
export const githubCreateRepoInputSchema = z.object({
  projectId: z.string().min(1),
  name: z
    .string()
    .min(1)
    .max(100)
    .regex(/^[A-Za-z0-9._-]+$/, 'Use only letters, numbers, dots, hyphens, and underscores.'),
  visibility: z.enum(['private', 'public']),
  description: z.string().max(350).optional(),
})

export const approvalDecisionSchema = z.object({
  approvalId: z.string().min(1),
  approve: z.boolean(),
})

export const requestApprovalSchema = z.object({
  projectId: z.string().min(1),
  actionType: approvalActionTypeSchema,
  summary: z.string().min(1),
  payload: z.record(z.unknown()).default({}),
})

export const ingestLogSchema = z.object({
  projectId: z.string().min(1),
  sourceType: z.enum(['terminal', 'git', 'railway', 'system', 'agent']),
  sourceId: z.string().nullable().optional(),
  message: z.string(),
})

export const dismissInsightSchema = z.object({
  projectId: z.string().min(1),
  matchedPattern: z.string().min(1),
})

// Account usage is global to the developer's CLI auth, not project-scoped, so
// the request carries no payload. We still validate it to reject stray input.
export const agentUsageRequestSchema = z.union([z.undefined(), z.object({}).strict()])
