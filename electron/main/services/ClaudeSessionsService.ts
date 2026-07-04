import { closeSync, openSync, readdirSync, readSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { ClaudeSessionSummary } from '@shared/domain'

/**
 * Surfaces Claude Code's own per-project conversation history so the cockpit can
 * offer "resume the last session" instead of always cold-starting `claude`.
 *
 * Claude Code persists every conversation as a `.jsonl` transcript under
 * `~/.claude/projects/<encoded-project-path>/<sessionId>.jsonl`. We never load a
 * full transcript (some run to tens of MB) — for the picker we only need a title
 * and timestamps, so we read each file's first chunk (the opening user prompt)
 * and lean on the filesystem `mtime` for "last active". This keeps listing fast
 * even with dozens of large transcripts.
 */
const HEAD_BYTES = 128 * 1024
const MAX_SESSIONS = 40
const TITLE_MAX = 100

/** Claude Code encodes a project's absolute path into the transcript dir name. */
function encodeProjectDir(projectPath: string): string {
  return projectPath.replace(/[/.]/g, '-')
}

export class ClaudeSessionsService {
  private readonly root: string

  constructor(root = join(homedir(), '.claude', 'projects')) {
    this.root = root
  }

  /** Absolute path to a session's `.jsonl` transcript (for the memory pipeline). */
  transcriptPath(projectPath: string, sessionId: string): string {
    return join(this.root, encodeProjectDir(projectPath), `${sessionId}.jsonl`)
  }

  /** Most-recent-first session summaries for the given project path. */
  list(projectPath: string): ClaudeSessionSummary[] {
    const dir = join(this.root, encodeProjectDir(projectPath))
    let files: string[]
    try {
      files = readdirSync(dir).filter((f) => f.endsWith('.jsonl'))
    } catch {
      return [] // no Claude history for this project yet
    }
    const out: ClaudeSessionSummary[] = []
    for (const file of files) {
      const summary = this.summarize(join(dir, file), file.replace(/\.jsonl$/, ''))
      if (summary) out.push(summary)
    }
    out.sort((a, b) => b.lastActiveAt.localeCompare(a.lastActiveAt))
    return out.slice(0, MAX_SESSIONS)
  }

  private summarize(path: string, id: string): ClaudeSessionSummary | null {
    let stat: ReturnType<typeof statSync>
    try {
      stat = statSync(path)
    } catch {
      return null
    }
    const head = this.readHead(path)
    if (!head) return null

    let firstTs: string | null = null
    let title: string | null = null
    for (const raw of head.split('\n')) {
      const line = raw.trim()
      if (!line) continue
      let obj: Record<string, unknown>
      try {
        obj = JSON.parse(line) as Record<string, unknown>
      } catch {
        continue // a truncated final line in the head buffer — skip
      }
      if (!firstTs && typeof obj.timestamp === 'string') firstTs = obj.timestamp
      if (!title && obj.type === 'user') {
        const clean = cleanTitle(extractUserText(obj.message))
        if (clean) title = clean
      }
      if (title && firstTs) break
    }
    if (!title) return null // no human prompt found — not a resumable conversation

    return {
      id,
      title: title.slice(0, TITLE_MAX),
      createdAt: firstTs ?? stat.birthtime.toISOString(),
      lastActiveAt: stat.mtime.toISOString(),
      sizeBytes: stat.size,
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

/** Pull the first human-authored text out of a transcript `message` payload. */
function extractUserText(message: unknown): string | null {
  if (!message || typeof message !== 'object') return null
  const content = (message as { content?: unknown }).content
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    for (const block of content) {
      if (
        block &&
        typeof block === 'object' &&
        (block as { type?: unknown }).type === 'text' &&
        typeof (block as { text?: unknown }).text === 'string'
      ) {
        return (block as { text: string }).text
      }
    }
  }
  return null
}

/** Turn a raw first message into a clean one-line title, or null if it is noise. */
function cleanTitle(text: string | null): string | null {
  if (!text) return null
  let s = text.trim()
  if (!s) return null
  // Tool/system/command wrappers and meta lines are not real prompts.
  if (s.startsWith('<')) return null
  if (s.startsWith('Caveat:')) return null
  if (s.startsWith('[Request interrupted')) return null
  // Drop a leading screenshot preface so the actual instruction becomes the title.
  s = s.replace(/^Screenshot attached:\s*"[^"]*"\s*/i, '').trim()
  if (!s) return '📎 Screenshot'
  s = s.replace(/\s+/g, ' ') // collapse to a single line
  return s.length >= 2 ? s : null
}
