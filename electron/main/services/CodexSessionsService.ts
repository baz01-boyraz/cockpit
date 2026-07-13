import { closeSync, openSync, readdirSync, readSync, statSync, type Dirent } from 'node:fs'
import { homedir } from 'node:os'
import { resolve, join } from 'node:path'
import type { CapturableSessionSummary, ResumableSessionSummary } from '@shared/domain'

const HEAD_BYTES = 128 * 1024
const MAX_SESSIONS = 40
const TITLE_MAX = 100

/**
 * Reads Codex CLI's active rollout transcripts and surfaces sessions belonging
 * to one project. Archived rollouts intentionally live outside this root and
 * are not offered until Codex guarantees they are directly resumable.
 */
export class CodexSessionsService {
  constructor(private readonly root = join(homedir(), '.codex', 'sessions')) {}

  list(projectPath: string): ResumableSessionSummary[] {
    return this.captureList(projectPath).map(({ transcriptPath: _transcriptPath, ...summary }) => summary)
  }

  /** Internal capture model; transcript paths never cross the renderer boundary. */
  captureList(projectPath: string): CapturableSessionSummary[] {
    const files = this.collectFiles(this.root)
      .map((path) => {
        try {
          return { path, mtimeMs: statSync(path).mtimeMs }
        } catch {
          return null
        }
      })
      .filter((entry): entry is { path: string; mtimeMs: number } => entry !== null)
      .sort((a, b) => b.mtimeMs - a.mtimeMs)

    const out: CapturableSessionSummary[] = []
    for (const file of files) {
      const summary = this.summarize(file.path, projectPath)
      if (summary) out.push(summary)
      if (out.length >= MAX_SESSIONS) break
    }
    return out
  }

  private collectFiles(dir: string): string[] {
    let entries: Dirent<string>[]
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      return []
    }

    const files: string[] = []
    for (const entry of entries) {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) files.push(...this.collectFiles(path))
      else if (entry.isFile() && entry.name.endsWith('.jsonl')) files.push(path)
    }
    return files
  }

  private summarize(path: string, projectPath: string): CapturableSessionSummary | null {
    let stat: ReturnType<typeof statSync>
    try {
      stat = statSync(path)
    } catch {
      return null
    }

    const head = this.readHead(path)
    if (!head) return null

    let id: string | null = null
    let cwd: string | null = null
    let createdAt: string | null = null
    let title: string | null = null

    for (const raw of head.split('\n')) {
      if (!raw.trim()) continue
      let record: Record<string, unknown>
      try {
        record = JSON.parse(raw) as Record<string, unknown>
      } catch {
        continue
      }

      if (record.type === 'session_meta') {
        const payload = asRecord(record.payload)
        if (payload) {
          if (typeof payload.id === 'string') id = payload.id
          if (typeof payload.cwd === 'string') cwd = payload.cwd
        }
        if (typeof record.timestamp === 'string') createdAt = record.timestamp
      }

      if (!title && record.type === 'event_msg') {
        const payload = asRecord(record.payload)
        if (payload?.type === 'user_message' && typeof payload.message === 'string') {
          title = cleanTitle(payload.message)
        }
      }

      if (id && cwd && createdAt && title) break
    }

    if (!id || !cwd || !title) return null
    if (resolve(cwd) !== resolve(projectPath)) return null

    return {
      id,
      provider: 'codex',
      title: title.slice(0, TITLE_MAX),
      createdAt: createdAt ?? stat.birthtime.toISOString(),
      lastActiveAt: stat.mtime.toISOString(),
      sizeBytes: stat.size,
      transcriptPath: path,
    }
  }

  private readHead(path: string): string | null {
    let fd: number
    try {
      fd = openSync(path, 'r')
    } catch {
      return null
    }
    try {
      const buf = Buffer.alloc(HEAD_BYTES)
      const n = readSync(fd, buf, 0, HEAD_BYTES, 0)
      return buf.subarray(0, n).toString('utf8')
    } catch {
      return null
    } finally {
      closeSync(fd)
    }
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : null
}

function cleanTitle(value: string): string | null {
  let title = value.trim()
  if (!title || title.startsWith('<') || title.startsWith('Side conversation boundary.')) return null
  title = title.replace(/^Screenshot attached:\s*"[^"]*"\s*/i, '').trim()
  title = title.replace(/\s+/g, ' ')
  return title.length >= 2 ? title : null
}
