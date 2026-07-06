import { spawn } from 'node:child_process'
import { connect } from 'node:net'
import { readdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import type { ProjectService } from '../ProjectService'
import { resolveBin } from '../resolveBin'

/**
 * The Hermes `take_app_screenshot` tool. There is no pre-existing service for
 * this — this is the first one, wrapping the CLAUDE.md localhost workflow
 * (`npm run build` → `node serve.mjs` → `node screenshot.mjs <url> <label>`).
 *
 * DESIGN DECISION — rebuild-vs-reuse: this ALWAYS runs a fresh `npm run build`
 * before screenshotting. Hermes calls this right after a Claude Code swarm task
 * changed the code, so reusing a stale `out/renderer` would silently screenshot
 * the OLD UI and mislead Hermes' review. Correctness beats speed here: the build
 * timeout is generous, and a build failure returns a clear error instead of
 * screenshotting stale output.
 */
const BUILD_TIMEOUT_MS = 12 * 60_000
const SCREENSHOT_TIMEOUT_MS = 90_000
const SERVE_READY_TIMEOUT_MS = 30_000
const DEFAULT_WAIT_MS = 1400
const SCREENSHOT_SUBDIR = 'temporary screenshots'
/** Fixed high port (adjacent to the MCP port) to avoid clashing with a dev serve on 3000. */
const DEFAULT_PORT = 47616

export interface ScreenshotRequest {
  label: string
  url?: string
  waitMs?: number
}

export interface ScreenshotResult {
  /** Absolute path to the saved PNG. Never the image bytes — Hermes references the file. */
  path: string
  url: string
  label: string
  /** Always true here — see the class-level rebuild-vs-reuse note. */
  rebuilt: boolean
}

interface ServeHandle {
  stop: () => Promise<void>
}

/**
 * The side-effecting steps, injected so the orchestration (including the
 * build-fails-so-do-not-screenshot short-circuit) is unit-testable without
 * spawning a real toolchain.
 */
export interface ScreenshotDeps {
  build(cwd: string): Promise<{ ok: boolean; message: string }>
  serve(cwd: string, port: number): Promise<ServeHandle>
  shoot(cwd: string, url: string, label: string, waitMs: number): Promise<{ stdout: string }>
  listShots(cwd: string): Promise<string[]>
}

function resolvePort(): number {
  const raw = process.env.HERMES_SCREENSHOT_PORT
  if (raw) {
    const parsed = Number(raw)
    if (Number.isInteger(parsed) && parsed > 0 && parsed < 65_536) return parsed
  }
  return DEFAULT_PORT
}

/** Pull the saved relative path out of screenshot.mjs's `✓ saved …` line. */
function parseSavedPath(stdout: string): string | null {
  const match = /saved\s+(temporary screenshots[/\\][^\s]+\.png)/.exec(stdout)
  return match ? match[1] : null
}

/** Fallback: the highest-numbered `screenshot-N-<label>.png` on disk. */
function newestShot(files: string[], label: string): string | null {
  let best: { n: number; file: string } | null = null
  for (const file of files) {
    const m = /^screenshot-(\d+)(?:-(.+))?\.png$/.exec(file)
    if (!m) continue
    if (label && m[2] !== label) continue
    const n = Number(m[1])
    if (!best || n > best.n) best = { n, file }
  }
  return best ? join(SCREENSHOT_SUBDIR, best.file) : null
}

export class AppScreenshotService {
  private readonly port: number

  constructor(
    private readonly projects: Pick<ProjectService, 'get'>,
    private readonly deps: ScreenshotDeps = defaultDeps(),
    port?: number,
  ) {
    this.port = port ?? resolvePort()
  }

  async capture(projectId: string, req: ScreenshotRequest): Promise<ScreenshotResult> {
    const project = this.projects.get(projectId)
    const cwd = resolve(project.path)

    // Correctness over speed: rebuild first so we never screenshot stale UI. A
    // failed build stops here — screenshotting the old output would mislead.
    const build = await this.deps.build(cwd)
    if (!build.ok) {
      throw new Error(`Build failed — refusing to screenshot stale output. ${build.message}`.trim())
    }

    const url = req.url ?? `http://localhost:${this.port}`
    const server = await this.deps.serve(cwd, this.port)
    try {
      const { stdout } = await this.deps.shoot(cwd, url, req.label, req.waitMs ?? DEFAULT_WAIT_MS)
      const rel = parseSavedPath(stdout) ?? newestShot(await this.deps.listShots(cwd), req.label)
      if (!rel) throw new Error('Screenshot ran but no output PNG could be located.')
      return { path: resolve(cwd, rel), url, label: req.label, rebuilt: true }
    } finally {
      await server.stop().catch(() => {})
    }
  }
}

// --- real, spawn-backed dependencies --------------------------------------

interface RunOutcome {
  code: number | null
  stdout: string
  stderr: string
}

/** Run a command to completion, capturing output; never rejects on non-zero exit. */
function runToEnd(
  bin: string,
  args: string[],
  opts: { cwd: string; timeout: number },
): Promise<RunOutcome> {
  return new Promise<RunOutcome>((resolveRun, rejectRun) => {
    const child = spawn(bin, args, { cwd: opts.cwd, env: { ...process.env } })
    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => {
      child.kill('SIGTERM')
    }, opts.timeout)
    child.stdout.on('data', (d: Buffer) => {
      stdout += d.toString('utf8')
    })
    child.stderr.on('data', (d: Buffer) => {
      stderr += d.toString('utf8')
    })
    child.on('error', (err) => {
      clearTimeout(timer)
      rejectRun(err)
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      resolveRun({ code, stdout, stderr })
    })
  })
}

/** Poll a TCP connect until the serve process accepts, or time out. */
function waitForPort(port: number, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs
  return new Promise<void>((resolveReady, rejectReady) => {
    const attempt = (): void => {
      const socket = connect(port, '127.0.0.1')
      socket.once('connect', () => {
        socket.destroy()
        resolveReady()
      })
      socket.once('error', () => {
        socket.destroy()
        if (Date.now() > deadline) {
          rejectReady(new Error(`serve.mjs did not come up on port ${port} within ${timeoutMs}ms`))
          return
        }
        setTimeout(attempt, 200)
      })
    }
    attempt()
  })
}

function defaultDeps(): ScreenshotDeps {
  const node = resolveBin('node')
  const npm = resolveBin('npm')
  return {
    async build(cwd) {
      const out = await runToEnd(npm, ['run', 'build'], { cwd, timeout: BUILD_TIMEOUT_MS })
      if (out.code === 0) return { ok: true, message: '' }
      const tail = (out.stderr || out.stdout).slice(-1500).trim()
      return { ok: false, message: tail || `build exited with code ${out.code}` }
    },
    async serve(cwd, port) {
      const child = spawn(node, ['serve.mjs'], {
        cwd,
        env: { ...process.env, PORT: String(port) },
      })
      // Surface spawn errors as a rejected readiness wait rather than a crash.
      child.on('error', () => {})
      await waitForPort(port, SERVE_READY_TIMEOUT_MS).catch(async (err) => {
        child.kill('SIGTERM')
        throw err
      })
      return {
        stop: () =>
          new Promise<void>((done) => {
            child.once('close', () => done())
            child.kill('SIGTERM')
          }),
      }
    },
    async shoot(cwd, url, label, waitMs) {
      const out = await runToEnd(node, ['screenshot.mjs', url, label, `--wait=${waitMs}`], {
        cwd,
        timeout: SCREENSHOT_TIMEOUT_MS,
      })
      if (out.code !== 0) {
        throw new Error(`screenshot.mjs failed: ${(out.stderr || out.stdout).slice(-1000).trim()}`)
      }
      return { stdout: out.stdout }
    },
    async listShots(cwd) {
      return readdir(join(cwd, SCREENSHOT_SUBDIR)).catch(() => [])
    },
  }
}
