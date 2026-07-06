import { execFile } from 'node:child_process'
import { homedir } from 'node:os'
import { promisify } from 'node:util'
import { buildHermesArgs } from '@shared/hermes-run'
import {
  type Observation,
  buildDistillPrompt,
  parseObservations,
} from '@shared/memory-observation'
import type { ProjectService } from './ProjectService'
import { resolveBin } from './resolveBin'
import { TranscriptReader } from './TranscriptReader'

const execFileAsync = promisify(execFile)

/**
 * Runs one non-interactive `hermes --oneshot` and returns its final message.
 *
 * The distiller was moved off the local `claude` CLI onto Hermes/DeepSeek
 * (docs/plans/hermes.md Faz 5): the local CLI looked "free" but drew down the
 * exact Claude coding quota we want to reserve for coding, whereas a DeepSeek
 * distill costs well under a cent per session. The transcript is redacted
 * upstream in `TranscriptReader.read(path, offset, true)` before it ever reaches
 * the prompt, so which binary runs the distillation does not affect redaction.
 */
export type DistillRunner = (cwd: string, prompt: string, model?: string) => Promise<string>

const defaultRunner: DistillRunner = async (cwd, prompt, model) => {
  const bin = resolveBin('hermes')
  const { stdout } = await execFileAsync(bin, buildHermesArgs(prompt, { model }), {
    cwd,
    timeout: 180_000,
    maxBuffer: 8 * 1024 * 1024,
    env: { ...process.env },
  })
  return stdout
}

export interface DistillRequest {
  projectId: string
  transcriptPath: string
  fromOffset?: number
  projectSlugs: string[]
  userSlugs: string[]
  /** Optional model alias for `claude --model`; omit to use Baz's default. */
  model?: string
}

export interface DistillOutput {
  observations: Observation[]
  /** New transcript byte offset — persist this as the capture cursor. */
  nextOffset: number
  /** Set when even the retry failed to yield valid JSON (nothing was written). */
  error?: string
}

/**
 * Stage 2 of the memory pipeline: read a redacted transcript and ask the Hermes
 * CLI for the few facts worth remembering (docs/memory-imp.md Phase 2,
 * docs/plans/hermes.md Faz 5). The CLI runner is injectable so the pipeline is
 * unit-testable without spawning `hermes`. One corrective retry guards against a
 * stray non-JSON reply.
 */
export class MemoryDistiller {
  constructor(
    private readonly projects: ProjectService,
    private readonly reader: TranscriptReader = new TranscriptReader(),
    private readonly runner: DistillRunner = defaultRunner,
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

    const cwd = this.cwdFor(req.projectId)
    const prompt = buildDistillPrompt({
      turns,
      projectSlugs: req.projectSlugs,
      userSlugs: req.userSlugs,
    })

    let raw: string
    try {
      raw = await this.runner(cwd, prompt, req.model)
    } catch (err) {
      return { observations: [], nextOffset, error: `distiller CLI failed: ${(err as Error).message}` }
    }

    let parsed = parseObservations(raw)
    if (!parsed.ok) {
      // One corrective retry — a reply wrapped in prose or a fence is common.
      try {
        const retry = await this.runner(
          cwd,
          `${prompt}\n\nYour previous reply was not valid. Reply with STRICT JSON only, no prose, no code fence.`,
          req.model,
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
