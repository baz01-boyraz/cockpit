/**
 * Zod schemas for validating data crossing trust boundaries:
 *   - the on-disk `.dev-cockpit/project.json` config
 *   - IPC request payloads coming from the renderer
 *
 * Never trust external data. Every IPC handler validates its input with one of
 * these schemas before touching the filesystem, git, or a child process.
 */
import { z } from 'zod'

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
})

export const routeQuerySchema = z.object({
  projectId: z.string().min(1),
  query: z.string().min(1).max(4000),
})

export const chatAskSchema = z.object({
  projectId: z.string().min(1),
  prompt: z.string().min(1).max(16000),
  engine: z.enum(['claude', 'codex']).default('claude'),
})

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
