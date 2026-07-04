import { execFile } from 'node:child_process'
import { homedir } from 'node:os'
import { promisify } from 'node:util'
import { buildClaudeArgs } from '@shared/claude-run'
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
 * Runs one non-interactive `claude --print` and returns its final message.
 * Locked to the user's local, already-authenticated Claude CLI — the distiller
 * NEVER uses an API key or any other provider (docs/memory-imp.md, hard rule).
 */
export type ClaudeRunner = (cwd: string, prompt: string, model?: string) => Promise<string>

const defaultRunner: ClaudeRunner = async (cwd, prompt, model) => {
  const bin = resolveBin('claude')
  const { stdout } = await execFileAsync(bin, buildClaudeArgs(prompt, { model }), {
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
 * Stage 2 of the memory pipeline: read a redacted transcript and ask the local
 * Claude CLI for the few facts worth remembering (docs/memory-imp.md Phase 2).
 * The CLI runner is injectable so the pipeline is unit-testable without spawning
 * `claude`. One corrective retry guards against a stray non-JSON reply.
 */
export class MemoryDistiller {
  constructor(
    private readonly projects: ProjectService,
    private readonly reader: TranscriptReader = new TranscriptReader(),
    private readonly runner: ClaudeRunner = defaultRunner,
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
