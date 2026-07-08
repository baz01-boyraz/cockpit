import { z } from 'zod'
import {
  memoryResolveReviewSchema,
  memoryWriteSchema,
  projectIdSchema,
} from '@shared/schemas'
import { BAZ_GLOBAL_BRAIN, projectBrain } from '@shared/memory-ledger'
import { gateMemoryWrite } from '@shared/memory-gate'
import type { HermesTool, HermesToolContext } from './hermesToolTypes'

/**
 * Memory tools (Faz 4 step 9 + Faz 5; write-gated in Faz C). Let Hermes read the
 * project brain, save a durable fact, and drive the review queue by conversation.
 * Every AGENT write passes the charter write-gate (docs/MEMORY-CHARTER.md): a
 * justified, non-duplicate, secret-free fact lands directly; a weak/unjustified
 * one is routed into the SAME review queue the distiller uses; a secret is
 * refused. The read/list/resolve paths re-parse with the same schema the
 * renderer's IPC handler uses — the underlying write stays path-safe and
 * validated.
 */

/** The charter justification the write tool asks the agent to attach (its OWN zod). */
const justificationShape = z.object({
  sevenDayScenario: z
    .string()
    .max(500)
    .describe(
      'The concrete situation, within ~7+ days, in which someone will need this exact fact. Not "might be useful".',
    ),
  dedupChecked: z
    .enum(['updates-existing', 'no-overlap'])
    .describe(
      'Dedup-first: you read the existing notes and either folded this into one (updates-existing) or confirmed there is no overlap (no-overlap).',
    ),
  targetNote: z.string().max(120).optional().describe('The related/updated note slug, when known.'),
  evidence: z.string().max(2000).describe('What the fact rests on — the decision, the error, the transcript.'),
})

/** Agent write input = the renderer write schema + the charter justification. */
const gatedWriteSchema = memoryWriteSchema.extend({
  justification: justificationShape.optional(),
})

export function createMemoryTools(ctx: HermesToolContext): HermesTool[] {
  return [
    {
      name: 'read_memory_recent',
      description:
        "Read the project's memory hub — all durable knowledge notes (name, content, updatedAt) plus the assembled graph. Read-only. ALWAYS call this before write_memory_summary: the charter is dedup-first, so you must build on what's already known and UPDATE an existing note rather than create a near-duplicate sibling.",
      inputShape: projectIdSchema.shape,
      run: async (raw) => ctx.memory.list(projectIdSchema.parse(raw).projectId),
    },
    {
      name: 'write_memory_summary',
      description:
        'Save ONE durable fact to the project memory hub, held to the memory charter (docs/MEMORY-CHARTER.md). Quality over quantity — an empty write is better than a junk write. Before writing, apply the 7-DAY TEST: name the concrete situation, within ~7+ days, in which someone needs this exact fact; if you cannot, do NOT write. DEDUP-FIRST: read the notes first (read_memory_recent) and prefer updating an existing note over a new one. Include the WHY for a decision, and for a gotcha paste the VERBATIM symptom text (an error you cannot find by its message is a dead memory). NEVER write secrets. `name` is a kebab-case slug (≤120 chars); `content` is markdown (≤500,000, but one focused fact ≤6,000). Attach `justification` (7-day scenario, dedup check, evidence). A justified, deduped, secret-free write is saved directly; a weak or unjustified one is routed to the human review queue (not lost); secret-shaped content is refused.',
      inputShape: gatedWriteSchema.shape,
      run: async (raw) => {
        const { projectId, name, content, justification } = gatedWriteSchema.parse(raw)
        const existingNames = ctx.memory.list(projectId).notes.map((n) => n.name)
        const gate = gateMemoryWrite({
          name,
          content,
          justification: justification ?? null,
          existingNames,
        })

        if (gate.verdict === 'reject') {
          ctx.audit?.record({
            projectId,
            actor: 'ai',
            actionType: 'memory_write_gate',
            summary: 'memory write rejected by charter',
            payload: { slug: name, verdict: 'reject', reasons: gate.reasons },
          })
          throw new Error(
            `Memory write refused by the charter (docs/MEMORY-CHARTER.md): ${gate.reasons.join('; ')}. Secrets never go in memory — remove the secret and try again.`,
          )
        }

        if (gate.verdict === 'review') {
          const item = ctx.memoryReviews.create({
            brain: projectBrain(projectId),
            kind: 'new',
            slug: name,
            title: name,
            proposedContent: content,
            reason: gate.reasons.join('; '),
            sourceId: null,
          })
          ctx.audit?.record({
            projectId,
            actor: 'ai',
            actionType: 'memory_write_gate',
            summary: 'memory write routed to review by charter',
            payload: { slug: name, verdict: 'review', reasons: gate.reasons },
          })
          return {
            queued: true,
            reviewId: item.id,
            verdict: 'review' as const,
            reasons: gate.reasons,
            message:
              'Not saved directly — the charter routed this to the review queue. Strengthen the justification (a concrete 7-day scenario), update an existing note instead of a twin, or split an oversized note. The human/you can accept it via resolve_memory_review.',
          }
        }

        ctx.audit?.record({
          projectId,
          actor: 'ai',
          actionType: 'memory_write_gate',
          summary: 'memory write accepted by charter',
          payload: { slug: name, verdict: 'accept' },
        })
        return ctx.memory.write(projectId, name, content)
      },
    },
    {
      name: 'get_pending_memory_reviews',
      description:
        "Read the unified pending memory-review queue: proposals for this project's brain plus cross-project Baz-brain proposals, concatenated. These are distilled notes — and charter-gated writes — awaiting an accept/edit/discard decision.",
      inputShape: projectIdSchema.shape,
      run: async (raw) => {
        const { projectId } = projectIdSchema.parse(raw)
        return [
          ...ctx.memoryReviews.listPending(projectBrain(projectId)),
          ...ctx.memoryReviews.listPending(BAZ_GLOBAL_BRAIN),
        ]
      },
    },
    {
      name: 'resolve_memory_review',
      description:
        "Resolve one queued memory review. `decision` is 'accept' (write as proposed), 'edit' (write `editedContent` instead), or 'discard' (drop it). Returns this project's remaining pending queue after the decision is applied.",
      inputShape: memoryResolveReviewSchema.shape,
      run: async (raw) => {
        const { projectId, reviewId, decision, editedContent } = memoryResolveReviewSchema.parse(raw)
        ctx.memoryPipeline.resolveReview(projectId, reviewId, decision, editedContent)
        return ctx.memoryReviews.listPending(projectBrain(projectId))
      },
    },
  ]
}
