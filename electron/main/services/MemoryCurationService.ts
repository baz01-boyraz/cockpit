import { randomUUID } from 'node:crypto'
import { homedir } from 'node:os'
import {
  MEMORY_ANALYSIS_ENGINE,
  MEMORY_ANALYSIS_ROLE,
  MEMORY_MODEL_POLICY_VERSION,
} from '@shared/memory-model-policy'
import { projectBrain } from '@shared/memory-ledger'
import { mergeDuplicate } from '@shared/memory-consolidate'
import { extractHook } from '@shared/memory-hub'
import {
  buildCurationPrompt,
  parseCurationResponse,
  type CurationNote,
  type CurationProposal,
} from '@shared/memory-curation'
import type { AuditLogService } from './AuditLogService'
import type { MemoryHubService } from './MemoryHubService'
import type { MemoryReviewService } from './MemoryReviewService'

/**
 * Provider-neutral analysis seam. The injected runner receives one bounded
 * prompt and no tools or file-write capability.
 */
export type CurationRunner = (cwd: string, prompt: string) => Promise<string>

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * The weekly curation sweep (docs/MEMORY-CHARTER.md → Lifecycle). One bounded
 * analysis call reads the note inventory and proposes archive/merge for stale or
 * duplicate notes; each non-keep proposal is queued to the SAME review queue the
 * distiller uses — a suggestion for the owner, NEVER a direct file operation.
 *
 * Contract: {@link sweep} NEVER throws. A missing hub, an empty hub, a spawn
 * failure, a timeout, and garbage output all degrade to null; only real,
 * inventory-backed proposals become review items.
 */
export class MemoryCurationService {
  constructor(
    private readonly memory: Pick<MemoryHubService, 'listDocs'>,
    private readonly reviews: Pick<MemoryReviewService, 'create'>,
    private readonly audit: Pick<AuditLogService, 'record'>,
    private readonly runner: CurationRunner,
    private readonly now: () => number = () => Date.now(),
  ) {}

  async sweep(projectId: string): Promise<{ proposals: number } | null> {
    // Full docs: hooks feed the prompt, but a merge proposal needs both bodies to
    // build the survivor content (mirrors MemoryConsolidator's maintenance merges).
    let docs
    try {
      docs = this.memory.listDocs(projectId)
    } catch {
      return this.fail(projectId, 'inventory')
    }
    if (docs.length === 0) return null // nothing to curate

    const nowMs = this.now()
    const byName = new Map(docs.map((d) => [d.name, d]))
    const inventory: CurationNote[] = docs.map((d) => ({
      name: d.name,
      hook: extractHook(d.content),
      ageDays: ageDays(d.updatedAt, nowMs),
    }))

    let proposals: CurationProposal[] | null
    try {
      const fenceTag = `====COCKPIT-UNTRUSTED-MEMORY-${randomUUID()}====`
      const prompt = buildCurationPrompt(inventory, fenceTag)
      const output = await this.runner(homedir(), prompt)
      proposals = parseCurationResponse(output)
    } catch {
      // Timeout / spawn-fail / anything: a missed sweep costs nothing. We build
      // NO error string from the argv (the raw-argv leak lesson).
      return this.fail(projectId, 'runner')
    }
    // Unparseable output = the model failed. Record a failure event, never a
    // successful `memory.curation_sweep`, so cadence still retries. A valid empty
    // array falls through to a recorded zero-proposal sweep (the hub is healthy).
    if (proposals === null) return this.fail(projectId, 'parse')

    // Defense in depth: only act on proposals that reference REAL notes, and a
    // merge whose survivor is a real, distinct note. A hallucinated name never
    // reaches the review queue.
    const brain = projectBrain(projectId)
    const nowIso = new Date(nowMs).toISOString()
    let queued = 0
    for (const p of proposals) {
      const note = byName.get(p.note)
      if (!note) continue
      if (p.action === 'archive') {
        this.reviews.create({
          brain,
          kind: 'maintenance',
          slug: p.note,
          // The sweep only proposes. If accepted later, the pipeline verifies
          // this exact content is still current before soft-deleting the note.
          title: `Archive stale note: ${p.note}`,
          proposedContent: note.content,
          reason: `Curation — archive: ${p.reason}`,
          existingContent: note.content,
          operation: 'archive',
        })
        queued += 1
      } else {
        const into = byName.get(p.into ?? '')
        if (!into || into.name === p.note) continue
        this.reviews.create({
          brain,
          kind: 'maintenance',
          slug: into.name,
          title: `Merge duplicate: ${p.note} → ${into.name}`,
          // Accepting folds p.note into the survivor and trashes the duplicate —
          // the exact shape MemoryConsolidator uses for its maintenance merges.
          proposedContent: mergeDuplicate(into.name, into.content, p.note, note.content, nowIso),
          reason: `Curation — merge: ${p.reason}`,
          existingContent: into.content,
          operation: 'merge',
          alsoTrash: p.note,
          alsoTrashContent: note.content,
        })
        queued += 1
      }
    }

    this.audit.record({
      projectId,
      actor: 'ai',
      actionType: 'memory.curation_sweep',
      summary: `Memory curation sweep: ${queued} proposal(s) queued from ${inventory.length} note(s)`,
      // Counts + routing metadata only — never a note name or hook.
      payload: {
        proposals: queued,
        notes: inventory.length,
        model: MEMORY_ANALYSIS_ENGINE.model,
        modelRole: MEMORY_ANALYSIS_ROLE,
        modelPolicyVersion: MEMORY_MODEL_POLICY_VERSION,
      },
    })
    return { proposals: queued }
  }

  /** Content-free failure audit; success cadence still keys only curation_sweep. */
  private fail(projectId: string, stage: 'inventory' | 'runner' | 'parse'): null {
    try {
      this.audit.record({
        projectId,
        actor: 'system',
        actionType: 'memory.curation_failed',
        summary: 'Memory curation sweep did not complete',
        payload: { stage },
      })
    } catch {
      // sweep() is best-effort and never throws, including audit failures.
    }
    return null
  }
}

/** Whole-day age of an ISO timestamp relative to `nowMs`; 0 for an unparseable one. */
function ageDays(updatedAt: string, nowMs: number): number {
  const at = Date.parse(updatedAt)
  if (Number.isNaN(at)) return 0
  return Math.max(0, (nowMs - at) / DAY_MS)
}
