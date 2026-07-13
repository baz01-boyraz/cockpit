import { randomUUID } from 'node:crypto'
import { readFileSync, statSync } from 'node:fs'
import { resolve, sep } from 'node:path'
import { simpleGit } from 'simple-git'
import {
  PER_FILE_CHAR_CAP,
  parseUnifiedDiff,
  sanitizeDiff,
  type DiffFileInput,
} from '@shared/diff-sanitize'
import {
  buildReviewPrompt,
  parseFindings,
  type DiffStat,
  type ReviewFinding,
  type ReviewResult,
  type ReviewStats,
} from '@shared/review'
import { SPECS, isSpec } from '@shared/agent-taxonomy'
import type { MemoryContextProvider, MemoryContextSurface } from '@shared/memory-context'
import type { AuditLogService } from './AuditLogService'
import type { ProjectService } from './ProjectService'

/** Injectable so tests never spawn a real CLI. */
export type CliRunner = (
  bin: string,
  args: string[],
  opts: { cwd: string; timeout: number; maxBuffer: number },
) => Promise<{ stdout: string }>

const defaultRunner: CliRunner = async () => {
  throw new Error('Standalone AI review was removed. Use the Council diff review instead.')
}

/**
 * Read one untracked file as a synthetic all-additions diff. Binary content
 * (NUL sniff) and oversized files degrade to a one-line note — the sanitizer
 * budget never inlines something the reviewer can't use anyway.
 */
function readUntracked(absPath: string, relPath: string): DiffFileInput | null {
  try {
    const st = statSync(absPath)
    if (!st.isFile()) return null
    if (st.size > PER_FILE_CHAR_CAP * 2) {
      return {
        path: relPath,
        diff: `+[new file, ${st.size} bytes — too large to inline]`,
        untracked: true,
      }
    }
    const buf = readFileSync(absPath)
    if (buf.includes(0)) return { path: relPath, diff: '', binary: true, untracked: true }
    const body = buf
      .toString('utf8')
      .split('\n')
      .map((l) => `+${l}`)
      .join('\n')
    return { path: relPath, diff: body, untracked: true }
  } catch {
    return null
  }
}

/**
 * Collect the full pre-ship change set: staged + working-tree diffs plus
 * untracked files as synthetic additions. Paths from git are still confined to
 * the project root before any read (the renderer never supplies paths here,
 * but defense in depth costs one resolve()).
 */
export async function collectDiffInputs(projectPath: string): Promise<DiffFileInput[]> {
  const git = simpleGit({ baseDir: projectPath })
  const isRepo = await git.checkIsRepo().catch(() => false)
  if (!isRepo) return []

  const [stagedPatch, unstagedPatch, status] = await Promise.all([
    git.diff(['--no-color', '--staged']),
    git.diff(['--no-color']),
    git.status(),
  ])

  const byPath = new Map<string, DiffFileInput>()
  for (const f of [...parseUnifiedDiff(stagedPatch), ...parseUnifiedDiff(unstagedPatch)]) {
    const prev = byPath.get(f.path)
    if (prev) {
      byPath.set(f.path, {
        ...prev,
        diff: `${prev.diff}\n${f.diff}`,
        binary: Boolean(prev.binary || f.binary),
      })
    } else {
      byPath.set(f.path, f)
    }
  }

  const root = resolve(projectPath)
  for (const file of status.files) {
    if (!(file.index === '?' && file.working_dir === '?')) continue
    const abs = resolve(projectPath, file.path)
    if (abs !== root && !abs.startsWith(root + sep)) continue
    const synthetic = readUntracked(abs, file.path)
    if (synthetic) byPath.set(file.path, synthetic)
  }

  return [...byPath.values()]
}

/**
 * Pre-ship AI Diff Review (VISION Phase 4). Read-only by design: collects the
 * change set, pushes it through the shared sanitizer boundary, and parses an
 * injected reviewer defensively. Production uses Council for model review;
 * this service retains deterministic diff-stat and sanitizer plumbing. Every run is
 * audit-logged with stats only — never content.
 */
export class ReviewService {
  constructor(
    private readonly projects: ProjectService,
    private readonly audit: AuditLogService,
    private readonly runner: CliRunner = defaultRunner,
    private readonly memoryContexts?: MemoryContextProvider,
  ) {}

  async run(
    projectId: string,
    opts: { model?: string; dir?: string; lens?: string } = {},
  ): Promise<ReviewResult> {
    const started = Date.now()
    const project = this.projects.get(projectId)
    // `dir` reviews a swarm worktree instead of the project root. The renderer
    // is untrusted: only paths inside the project are ever used as a git cwd.
    let base = project.path
    if (opts.dir) {
      const target = resolve(opts.dir)
      if (!target.startsWith(resolve(project.path) + sep)) {
        throw new Error('Review dir must be inside the project.')
      }
      base = target
    }
    const inputs = await collectDiffInputs(base)
    return this.review(
      projectId,
      project,
      inputs,
      opts,
      started,
      'review_diff',
      inputs.map((input) => input.path).join('\n'),
    )
  }

  /**
   * Cheap, LLM-free `+N −M · K files` summary of a worktree, for the board's
   * at-a-glance In review / Parked readout. Same path confinement as `run`
   * (the renderer is untrusted); a non-repo or clean tree returns a plain zero
   * rather than throwing, so the badge simply renders nothing.
   */
  async diffStat(projectId: string, opts: { dir?: string } = {}): Promise<DiffStat> {
    const project = this.projects.get(projectId)
    let base = project.path
    if (opts.dir) {
      const target = resolve(opts.dir)
      if (!target.startsWith(resolve(project.path) + sep)) {
        throw new Error('Diff-stat dir must be inside the project.')
      }
      base = target
    }

    const git = simpleGit({ baseDir: base })
    const isRepo = await git.checkIsRepo().catch(() => false)
    if (!isRepo) return { files: 0, insertions: 0, deletions: 0 }

    const [staged, unstaged, status] = await Promise.all([
      git.diffSummary(['--staged']).catch(() => null),
      git.diffSummary().catch(() => null),
      git.status().catch(() => null),
    ])

    // Staged + unstaged edits overlap on a file (a partially-staged file shows
    // in both), so count files by unique path and sum the line deltas.
    const paths = new Set<string>()
    let insertions = 0
    let deletions = 0
    for (const summary of [staged, unstaged]) {
      if (!summary) continue
      insertions += summary.insertions
      deletions += summary.deletions
      for (const f of summary.files) paths.add(f.file)
    }

    // Untracked files never appear in a diff summary — count each as an added
    // file with its line count as insertions (best-effort; unreadable → skip).
    for (const file of status?.files ?? []) {
      if (!(file.index === '?' && file.working_dir === '?')) continue
      const abs = resolve(base, file.path)
      const root = resolve(base)
      if (abs !== root && !abs.startsWith(root + sep)) continue
      paths.add(file.path)
      try {
        const buf = readFileSync(abs)
        if (!buf.includes(0)) insertions += buf.toString('utf8').split('\n').length
      } catch {
        // Unreadable/removed between status and read — count the file, skip lines.
      }
    }

    return { files: paths.size, insertions, deletions }
  }

  /**
   * Review one captured text blob (a command block's command + output)
   * through the exact same sanitizer boundary as a diff review.
   */
  async runText(
    projectId: string,
    input: { label: string; content: string },
    opts: { model?: string } = {},
  ): Promise<ReviewResult> {
    const started = Date.now()
    const project = this.projects.get(projectId)
    return this.review(
      projectId,
      project,
      [{ path: input.label, diff: input.content }],
      opts,
      started,
      'review_text',
      `${input.label}\n${input.content}`,
    )
  }

  private async review(
    projectId: string,
    project: { name: string; path: string },
    inputs: DiffFileInput[],
    opts: { model?: string; lens?: string },
    started: number,
    memorySurface: MemoryContextSurface,
    memoryQuery: string,
  ): Promise<ReviewResult> {
    const sanitized = sanitizeDiff(inputs)
    const modelLabel = opts.model?.trim() || 'Council review'
    const memoryContext = this.memoryContexts?.forTask({
      projectId,
      surface: memorySurface,
      query: memoryQuery,
    })

    // Sanitizer verdicts surface as findings regardless of the model's answer.
    const suspectFindings: ReviewFinding[] = sanitized.injectionSuspects.map((s) => ({
      severity: 'high',
      file: s.path,
      line: null,
      title: 'Possible prompt-injection text in diff',
      detail: `The sanitizer flagged this line as trying to instruct the reviewer: "${s.line}"`,
    }))

    const stats = (durationMs: number): ReviewStats => ({
      filesReviewed: sanitized.files.length,
      filesBlocked: sanitized.blockedFiles.length,
      filesSummarized: sanitized.summarizedFiles.length,
      injectionSuspects: sanitized.injectionSuspects.length,
      truncated: sanitized.truncatedTotal,
      durationMs,
    })

    if (sanitized.files.length === 0 && sanitized.summarizedFiles.length === 0) {
      const result: ReviewResult = {
        ok: true,
        findings: suspectFindings,
        raw: null,
        model: modelLabel,
        error: null,
        stats: stats(Date.now() - started),
      }
      this.record(projectId, result)
      return result
    }

    const fenceTag = `====COCKPIT-UNTRUSTED-DIFF-${randomUUID()}====`
    // Domain lens: the text ALWAYS comes from the canonical taxonomy (SPECS),
    // keyed by id — renderer-supplied prose never reaches the prompt.
    const lensSpec = opts.lens && isSpec(opts.lens) ? opts.lens : null
    if (opts.lens && !lensSpec) throw new Error('Unknown review lens.')
    const basePrompt = buildReviewPrompt(sanitized, { fenceTag, projectName: project.name })
    const reviewedPrompt = lensSpec ? `${SPECS[lensSpec].prompt}\n\n${basePrompt}` : basePrompt
    const prompt = memoryContext
      ? `${memoryContext.block}\n\n${reviewedPrompt}`
      : reviewedPrompt

    try {
      // `ignoreRules: true` — a review pass is a narrow analytical task, not a
      // conversation, so it skips AGENTS.md/persona/MCP-tool injection just
      // like the memory distiller does.
      const { stdout } = await this.runner(
        'council-review',
        [prompt],
        {
          cwd: project.path,
          // A real repo's full diff can legitimately take minutes to reason
          // over; the timeout is a hang-guard, not a latency target.
          timeout: 360_000,
          maxBuffer: 8 * 1024 * 1024,
        },
      )
      const parsed = parseFindings(stdout)
      const result: ReviewResult = {
        ok: true,
        findings: [...suspectFindings, ...parsed.findings],
        raw: parsed.raw,
        model: modelLabel,
        error: null,
        stats: stats(Date.now() - started),
      }
      this.record(projectId, result)
      return result
    } catch (err) {
      const e = err as { stderr?: string; message?: string; killed?: boolean; signal?: string }
      const timedOut = e.killed === true || e.signal === 'SIGTERM'
      const result: ReviewResult = {
        ok: false,
        findings: suspectFindings,
        raw: null,
        model: modelLabel,
        error: timedOut
          ? 'Review timed out after 6 minutes — try a smaller change set or a faster model.'
          : e.stderr?.trim() || e.message || 'Review run failed.',
        stats: stats(Date.now() - started),
      }
      this.record(projectId, result)
      return result
    }
  }

  private record(projectId: string, result: ReviewResult): void {
    this.audit.record({
      projectId,
      actor: 'ai',
      actionType: 'review.run',
      summary: result.ok
        ? `Pre-ship review: ${result.stats.filesReviewed} file(s), ${result.findings.length} finding(s)`
        : `Pre-ship review failed: ${result.error}`,
      // Stats only — diff content never reaches the audit log.
      payload: { ...result.stats, model: result.model, ok: result.ok },
    })
  }
}
