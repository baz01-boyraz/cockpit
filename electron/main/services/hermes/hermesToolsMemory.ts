import {
  memoryResolveReviewSchema,
  memoryWriteSchema,
  projectIdSchema,
} from '@shared/schemas'
import { BAZ_GLOBAL_BRAIN, projectBrain } from '@shared/memory-ledger'
import type { HermesTool, HermesToolContext } from './hermesToolTypes'

/**
 * Memory tools (Faz 4 step 9 + Faz 5): let Hermes read the project brain, drop a
 * summary, and drive the review queue by conversation. Each wraps the exact
 * service call the renderer's IPC handler makes and re-parses with the same
 * schema — the write path stays gated by the identical ledger/validation.
 */
export function createMemoryTools(ctx: HermesToolContext): HermesTool[] {
  return [
    {
      name: 'read_memory_recent',
      description:
        "Read the project's memory hub — all durable knowledge notes (name, content, updatedAt) plus the assembled graph. Read-only. Use this before writing a summary so you build on what's already known instead of duplicating it.",
      inputShape: projectIdSchema.shape,
      run: async (raw) => ctx.memory.list(projectIdSchema.parse(raw).projectId),
    },
    {
      name: 'write_memory_summary',
      description:
        'Write (create or overwrite) a memory note. `name` is a note slug (≤ 120 chars); `content` is markdown (≤ 500,000 chars). Same validated, path-safe write the Memory tab uses. Returns the saved note.',
      inputShape: memoryWriteSchema.shape,
      run: async (raw) => {
        const { projectId, name, content } = memoryWriteSchema.parse(raw)
        return ctx.memory.write(projectId, name, content)
      },
    },
    {
      name: 'get_pending_memory_reviews',
      description:
        "Read the unified pending memory-review queue: proposals for this project's brain plus cross-project Baz-brain proposals, concatenated. These are distilled notes awaiting an accept/edit/discard decision.",
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
