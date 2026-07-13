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
import { BAZ_GLOBAL_BRAIN } from '@shared/memory-ledger'

type RecallSink = {
  record(brain: string, slugs: readonly string[], surface: MemoryContextSurface): void
}

/**
 * The single memory-read gateway for task execution. Every engine-facing
 * service asks this collaborator for context rather than reading/ranking the hub
 * itself. One call means: hub checked, a capability-appropriate lookup/inline
 * contract prepared, a receipt recorded, and failures made explicit.
 */
export class MemoryContextService implements MemoryContextProvider {
  constructor(
    private readonly memory: Pick<MemoryHubService, 'listDocs'>,
    private readonly recalls?: RecallSink,
    private readonly audit?: Pick<AuditLogService, 'record'>,
    private readonly idFactory: () => string = () => `memctx_${randomUUID()}`,
    private readonly globalMemory?: Pick<MemoryHubService, 'listDocs'>,
  ) {}

  forTask(input: MemoryContextRequest): MemoryContextEnvelope {
    const contextId = this.idFactory()
    let result: MemoryContextEnvelope
    try {
      const projectDocs = this.memory.listDocs(input.projectId).map((doc) => ({
        ...doc,
        brain: 'project' as const,
      }))
      const projectNames = new Set(projectDocs.map((doc) => doc.name))
      const globalDocs = (this.globalMemory?.listDocs(BAZ_GLOBAL_BRAIN) ?? [])
        .filter((doc) => !projectNames.has(doc.name))
        .map((doc) => ({ ...doc, brain: 'global' as const }))
      result = buildMemoryContext({
        contextId,
        surface: input.surface,
        query: input.query,
        docs: [...projectDocs, ...globalDocs],
      })
    } catch {
      result = buildUnavailableMemoryContext({ contextId, surface: input.surface })
    }

    const slugs = result.receipt.notes.map((note) => note.name)
    if (result.receipt.delivery === 'inline' && slugs.length > 0) {
      try {
        const projectSlugs = result.receipt.notes
          .filter((note) => note.brain === 'project')
          .map((note) => note.name)
        const globalSlugs = result.receipt.notes
          .filter((note) => note.brain === 'global')
          .map((note) => note.name)
        if (projectSlugs.length > 0) {
          this.recalls?.record(projectBrain(input.projectId), projectSlugs, input.surface)
        }
        if (globalSlugs.length > 0) this.recalls?.record(BAZ_GLOBAL_BRAIN, globalSlugs, input.surface)
      } catch {
        // Delivery already happened; telemetry can never revoke task context.
      }
    }

    const actionType =
      result.receipt.status === 'unavailable'
        ? 'memory.context_unavailable'
        : result.receipt.status === 'empty'
          ? 'memory.context_empty'
          : result.receipt.delivery === 'lookup'
            ? 'memory.context_lookup'
            : 'memory.context_delivered'
    try {
      this.audit?.record({
        projectId: input.projectId,
        actor: 'system',
        actionType,
        summary:
          result.receipt.status === 'unavailable'
            ? `Project memory unavailable for ${input.surface}`
            : result.receipt.status === 'empty'
              ? `Project memory checked for ${input.surface}: no relevant context`
              : result.receipt.delivery === 'lookup'
                ? `Project memory lookup required for ${input.surface}`
                : `Project memory hooks delivered to ${input.surface}: ${slugs.length} note(s)`,
        // Never store the task query or note content in audit — provenance only.
        payload: {
          contextId,
          surface: input.surface,
          status: result.receipt.status,
          delivery: result.receipt.delivery,
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
