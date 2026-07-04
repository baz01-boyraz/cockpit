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

export const reviewRunSchema = z.object({
  projectId: z.string().min(1),
  model: z.string().min(1).max(120).optional(),
  // Absolute path of a swarm worktree; main re-validates it sits inside the project.
  dir: z.string().min(1).max(1024).optional(),
  // Persona id from shared/agent-roles; main resolves it against the catalog.
  lens: z.string().min(1).max(60).optional(),
})

export const reviewRunTextSchema = z.object({
  projectId: z.string().min(1),
  label: z.string().min(1).max(200),
  content: z.string().min(1).max(400_000),
  model: z.string().min(1).max(120).optional(),
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

/** Session ids are Claude Code transcript UUIDs — no path characters allowed. */
export const memoryCaptureSchema = z.object({
  projectId: z.string().min(1),
  sessionId: z.string().min(1).max(200).regex(/^[A-Za-z0-9._-]+$/, 'invalid session id'),
  dryRun: z.boolean().optional(),
})

export const memoryResolveReviewSchema = z.object({
  projectId: z.string().min(1),
  reviewId: z.string().min(1).max(200),
  decision: z.enum(['accept', 'edit', 'discard']),
  editedContent: z.string().max(500_000).optional(),
})

export const memoryLedgerSchema = z.object({
  projectId: z.string().min(1),
  noteSlug: z.string().min(1).max(120).optional(),
})

export const memoryBazReadSchema = z.object({
  name: z.string().min(1).max(120),
})

export const swarmProjectSchema = z.object({
  projectId: z.string().min(1),
})

export const swarmCreateCardSchema = z.object({
  projectId: z.string().min(1),
  title: z.string().min(1).max(200),
  body: z.string().max(20_000).optional(),
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

export const swarmStartCardSchema = swarmRemoveCardSchema

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
