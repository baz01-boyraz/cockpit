import { homedir } from 'node:os'
import {
  type Observation,
  buildDistillPrompt,
  parseObservations,
} from '@shared/memory-observation'
import type { ProjectService } from './ProjectService'
import type { TranscriptReader } from './TranscriptReader'

/**
 * Provider-neutral, tool-less analysis seam. Services binds this to the
 * dedicated Memory model policy through EngineRunner; tests inject a pure fake.
 */
export type DistillRunner = (cwd: string, prompt: string) => Promise<string>

export interface DistillRequest {
  projectId: string
  transcriptPath: string
  fromOffset?: number
  projectSlugs: string[]
  userSlugs: string[]
  /** Queue visibility hook fired after transcript reading, before model analysis. */
  onDistilling?: () => void
}

export interface DistillOutput {
  observations: Observation[]
  /** New transcript byte offset — persist this as the capture cursor. */
  nextOffset: number
  /** Set when even the retry failed to yield valid JSON (nothing was written). */
  error?: string
}

/**
 * Stage 2 of the memory pipeline: read a redacted Claude or Codex transcript and
 * ask a bounded analysis seat for the few facts worth remembering. Capture and
 * analysis providers are independent. One corrective retry guards against a
 * stray non-JSON reply.
 */
export class MemoryDistiller {
  constructor(
    private readonly projects: ProjectService,
    private readonly reader: TranscriptReader,
    private readonly runner: DistillRunner,
  ) {}

  private cwdFor(projectId: string): string {
    try {
      return this.projects.get(projectId).path
    } catch {
      return homedir()
    }
  }

  async distill(req: DistillRequest): Promise<DistillOutput> {
    const { turns, nextOffset } = await this.reader.read(req.transcriptPath, req.fromOffset ?? 0, true)
    if (turns.length === 0) return { observations: [], nextOffset }
    req.onDistilling?.()

    const cwd = this.cwdFor(req.projectId)
    const prompt = buildDistillPrompt({
      turns,
      projectSlugs: req.projectSlugs,
      userSlugs: req.userSlugs,
    })

    let raw: string
    try {
      raw = await this.runner(cwd, prompt)
    } catch (err) {
      return { observations: [], nextOffset, error: `memory analysis failed: ${(err as Error).message}` }
    }

    let parsed = parseObservations(raw)
    if (!parsed.ok) {
      // One corrective retry — a reply wrapped in prose or a fence is common.
      try {
        const retry = await this.runner(
          cwd,
          `${prompt}\n\nYour previous reply was not valid. Reply with STRICT JSON only, no prose, no code fence.`,
        )
        parsed = parseObservations(retry)
      } catch (err) {
        return { observations: [], nextOffset, error: `distiller retry failed: ${(err as Error).message}` }
      }
    }

    if (!parsed.ok) return { observations: [], nextOffset, error: parsed.error }
    return { observations: parsed.observations, nextOffset }
  }
}
