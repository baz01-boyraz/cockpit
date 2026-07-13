import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { homedir } from 'node:os'
import { promisify } from 'node:util'
import { buildHermesArgs } from '@shared/hermes-run'
import {
  HERMES_BACKGROUND_MODEL,
  HERMES_MODEL_POLICY,
} from '@shared/hermes-model-policy'
import { assertHermesRuntimeEnabled } from '@shared/hermes-runtime'
import { projectBrain } from '@shared/memory-ledger'
import { mergeDuplicate } from '@shared/memory-consolidate'
import { extractHook } from '@shared/memory-hub'
import {
  buildCurationPrompt,
  parseCurationResponse,
  type CurationNote,
  type CurationProposal,
} from '@shared/memory-curation'
import { resolveBin } from './resolveBin'
import type { AuditLogService } from './AuditLogService'
import type { MemoryHubService } from './MemoryHubService'
import type { MemoryReviewService } from './MemoryReviewService'

const execFileAsync = promisify(execFile)

/** A curation sweep is one oneshot judgement, not a conversation — 60s is plenty. */
const CURATION_TIMEOUT_MS = 60 * 1000
/** Curation output is a small JSON array; a modest ceiling caps a runaway response. */
const MAX_OUTPUT_BYTES = 512 * 1024

/**
 * Injectable so unit tests never spawn a real `hermes`. Mirrors the
 * HermesTriageService runner shape/hygiene exactly: the prompt is one discrete
 * argv entry (never a shell string), so the fenced untrusted inventory can't
 * break out into the command line.
 */
export type HermesCurationRunner = (
  cwd: string,
  args: string[],
  opts: { timeout: number; maxBuffer: number },
) => Promise<{ stdout: string }>

const defaultRunner: HermesCurationRunner = (cwd, args, opts) => {
  assertHermesRuntimeEnabled()
  return execFileAsync(resolveBin('hermes'), args, { cwd, ...opts })
}

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * The weekly curation sweep (Faz D, docs/MEMORY-CHARTER.md → Lifecycle). One cheap
 * Hermes oneshot reads the note inventory and proposes archive/merge for stale or
 * duplicate notes; each non-keep proposal is queued to the SAME review queue the
 * distiller uses — a suggestion for the owner, NEVER a direct file operation.
 *
 * Contract: {@link sweep} NEVER throws. A missing hub, an empty hub, a spawn
 * failure, a timeout, and garbage output all degrade to null; only real,
 * inventory-backed proposals become review items. It reuses the triage runner
 * pattern exactly (resolveBin('hermes'), buildHermesArgs, ignoreRules: true, the
 * cheap DeepSeek model) — a mechanical judgement, not a project-context conversation.
 */
export class MemoryCurationService {
  constructor(
    private readonly memory: Pick<MemoryHubService, 'listDocs'>,
    private readonly reviews: Pick<MemoryReviewService, 'create'>,
    private readonly audit: Pick<AuditLogService, 'record'>,
    private readonly runner: HermesCurationRunner = defaultRunner,
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
      const args = buildHermesArgs(prompt, {
        model: HERMES_BACKGROUND_MODEL,
        ignoreRules: true,
      })
      const { stdout } = await this.runner(homedir(), args, {
        timeout: CURATION_TIMEOUT_MS,
        maxBuffer: MAX_OUTPUT_BYTES,
      })
      proposals = parseCurationResponse(stdout)
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
        model: HERMES_BACKGROUND_MODEL,
        modelRole: HERMES_MODEL_POLICY.background.role,
        modelPolicyVersion: HERMES_MODEL_POLICY.version,
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
