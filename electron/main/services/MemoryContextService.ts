import { randomUUID } from 'node:crypto'
import {
  buildMemoryContext,
  buildUnavailableMemoryContext,
  type MemoryContextEnvelope,
  type MemoryContextProvider,
  type MemoryContextRequest,
  type MemoryContextSurface,
} from '@shared/memory-context'
import { projectBrain } from '@shared/memory-ledger'
import type { AuditLogService } from './AuditLogService'
import type { MemoryHubService } from './MemoryHubService'

type RecallSink = {
  record(brain: string, slugs: readonly string[], surface: MemoryContextSurface): void
}

/**
 * The single memory-read gateway for task execution. Every engine-facing
 * service asks this collaborator for context rather than reading/ranking the hub
 * itself. One call means: hub checked, real content bounded+redacted, delivery
 * receipt recorded, and failures made explicit in the returned prompt block.
 */
export class MemoryContextService implements MemoryContextProvider {
  constructor(
    private readonly memory: Pick<MemoryHubService, 'listDocs'>,
    private readonly recalls?: RecallSink,
    private readonly audit?: Pick<AuditLogService, 'record'>,
    private readonly idFactory: () => string = () => `memctx_${randomUUID()}`,
  ) {}

  forTask(input: MemoryContextRequest): MemoryContextEnvelope {
    const contextId = this.idFactory()
    let result: MemoryContextEnvelope
    try {
      result = buildMemoryContext({
        contextId,
        surface: input.surface,
        query: input.query,
        docs: this.memory.listDocs(input.projectId),
      })
    } catch {
      result = buildUnavailableMemoryContext({ contextId, surface: input.surface })
    }

    const slugs = result.receipt.notes.map((note) => note.name)
    if (result.receipt.status === 'ready' && slugs.length > 0) {
      try {
        this.recalls?.record(projectBrain(input.projectId), slugs, input.surface)
      } catch {
        // Delivery already happened; telemetry can never revoke task context.
      }
    }

    const actionType =
      result.receipt.status === 'ready'
        ? 'memory.context_delivered'
        : result.receipt.status === 'empty'
          ? 'memory.context_empty'
          : 'memory.context_unavailable'
    try {
      this.audit?.record({
        projectId: input.projectId,
        actor: 'system',
        actionType,
        summary:
          result.receipt.status === 'ready'
            ? `Project memory delivered to ${input.surface}: ${slugs.length} note(s)`
            : result.receipt.status === 'empty'
              ? `Project memory checked for ${input.surface}: no context available`
              : `Project memory unavailable for ${input.surface}`,
        // Never store the task query or note content in audit — provenance only.
        payload: {
          contextId,
          surface: input.surface,
          status: result.receipt.status,
          notes: slugs,
          characters: result.receipt.characters,
        },
      })
    } catch {
      // The prompt receipt remains the source of truth when audit storage is down.
    }
    return result
  }
}
