/**
 * The AI Diff Review security boundary (pure, no runtime deps — VISION 4.1).
 *
 * Every diff line is untrusted input. Before anything reaches an AI prompt:
 *   - sensitive paths are EXCLUDED (reported by name + reason, never content);
 *   - every included line passes secret redaction (shared/redaction.ts);
 *   - lockfiles/binaries are summarized to one-line stats, not diffed;
 *   - per-file and total character budgets truncate DETERMINISTICALLY with
 *     visible markers — review quality may degrade, but never silently;
 *   - instruction-like text inside the diff is flagged as an injection suspect
 *     so the UI can warn regardless of what the model says.
 *
 * See docs/plans/ai-diff-review-plan.md for the full design.
 */
import { redactText } from './redaction'

export interface DiffFileInput {
  path: string
  /** Unified diff hunks for this file ('' for binary). */
  diff: string
  binary?: boolean
  untracked?: boolean
}

export interface SanitizedFile {
  path: string
  content: string
  truncated: boolean
  untracked: boolean
}

export interface BlockedFile {
  path: string
  reason: string
}

export interface SummarizedFile {
  path: string
  note: string
}

export interface InjectionSuspect {
  path: string
  line: string
}

export interface SanitizedDiff {
  files: SanitizedFile[]
  blockedFiles: BlockedFile[]
  summarizedFiles: SummarizedFile[]
  injectionSuspects: InjectionSuspect[]
  totalChars: number
  truncatedTotal: boolean
}

export const PER_FILE_CHAR_CAP = 40_000
export const TOTAL_CHAR_CAP = 250_000
/** Below this remaining budget a file is summarized rather than truncated. */
const MIN_USEFUL_SLICE = 2_000

const CONFIG_EXT = '(json|ya?ml|toml|ini|txt|env|cfg|conf|xml|properties)'

const SENSITIVE_RULES: { test: (path: string, base: string) => boolean; reason: string }[] = [
  { test: (_p, b) => b.startsWith('.env'), reason: 'environment file' },
  { test: (_p, b) => /\.(pem|key|p12|pfx|keystore|jks|crt|der)$/i.test(b), reason: 'key material' },
  { test: (_p, b) => /^id_(rsa|dsa|ecdsa|ed25519)/i.test(b), reason: 'ssh key' },
  {
    test: (_p, b) => new RegExp(`^credentials?(\\.${CONFIG_EXT})?$`, 'i').test(b),
    reason: 'credentials file',
  },
  {
    test: (_p, b) => new RegExp(`^secrets?(\\.${CONFIG_EXT})?$`, 'i').test(b),
    reason: 'secrets file',
  },
  { test: (_p, b) => b === '.npmrc' || b === '.netrc', reason: 'auth config' },
  { test: (_p, b) => /\.sqlite3?($|[-.])/i.test(b), reason: 'database file' },
  { test: (p) => p.includes('.dev-cockpit/secrets/'), reason: 'cockpit secret store' },
]

const LOCKFILE_NAMES = new Set([
  'package-lock.json',
  'yarn.lock',
  'pnpm-lock.yaml',
  'bun.lockb',
  'cargo.lock',
  'poetry.lock',
  'uv.lock',
  'composer.lock',
  'gemfile.lock',
  'flake.lock',
])

/**
 * Instruction-like text aimed at the reviewer. Deliberately narrow: a false
 * positive is only a warning chip in the UI, but a false negative would let a
 * hostile diff try to steer the model — so favor the phrases that actually
 * steer ("ignore previous instructions"), not everyday words.
 */
const INJECTION_PATTERNS: RegExp[] = [
  /ignore\s+(all\s+|any\s+)?(previous|prior|above|earlier)\s+(instructions?|rules?|prompts?)/i,
  /disregard\s+(the\s+)?(system\s+prompt|instructions?|rules?)/i,
  /you\s+are\s+now\s+[a-z]/i,
  /new\s+system\s+prompt/i,
  /<\/?system>/i,
  /\bdo\s+not\s+(report|mention|flag)\b/i,
  /\brespond\s+only\s+with\b.*\bapproved?\b/i,
]

function basenameOf(path: string): string {
  const idx = path.lastIndexOf('/')
  return idx === -1 ? path : path.slice(idx + 1)
}

/** Reason this path must never be sent to an AI, or null when it may. */
export function sensitivePathReason(path: string): string | null {
  const base = basenameOf(path).toLowerCase()
  for (const rule of SENSITIVE_RULES) {
    if (rule.test(path, base)) return rule.reason
  }
  return null
}

export function isLockfilePath(path: string): boolean {
  const base = basenameOf(path).toLowerCase()
  return LOCKFILE_NAMES.has(base) || base.endsWith('.lock')
}

function isDiffMetaLine(line: string): boolean {
  return (
    line.startsWith('diff --git') ||
    line.startsWith('index ') ||
    line.startsWith('--- ') ||
    line.startsWith('+++ ') ||
    line.startsWith('@@')
  )
}

function countChanges(diff: string): { added: number; removed: number } {
  let added = 0
  let removed = 0
  for (const line of diff.split('\n')) {
    if (line.startsWith('+') && !line.startsWith('+++')) added++
    else if (line.startsWith('-') && !line.startsWith('---')) removed++
  }
  return { added, removed }
}

function truncationMark(lines: number): string {
  return `[… ${lines} lines truncated by cockpiT sanitizer]`
}

/** Redact + cap one file's diff text. */
function sanitizeFileContent(diff: string, cap: number): { content: string; truncated: boolean } {
  const redacted = redactText(diff)
  if (redacted.length <= cap) return { content: redacted, truncated: false }
  const lines = redacted.split('\n')
  const kept: string[] = []
  let used = 0
  for (const line of lines) {
    if (used + line.length + 1 > cap) break
    kept.push(line)
    used += line.length + 1
  }
  const dropped = lines.length - kept.length
  kept.push(truncationMark(dropped))
  return { content: kept.join('\n'), truncated: true }
}

function findSuspects(path: string, content: string): InjectionSuspect[] {
  const out: InjectionSuspect[] = []
  for (const line of content.split('\n')) {
    if (isDiffMetaLine(line)) continue
    if (INJECTION_PATTERNS.some((re) => re.test(line))) {
      out.push({ path, line: line.slice(0, 240) })
    }
  }
  return out
}

/**
 * The boundary. Input order is preserved; output is fully deterministic for
 * identical input.
 */
export function sanitizeDiff(inputs: DiffFileInput[]): SanitizedDiff {
  const files: SanitizedFile[] = []
  const blockedFiles: BlockedFile[] = []
  const summarizedFiles: SummarizedFile[] = []
  const injectionSuspects: InjectionSuspect[] = []
  let budget = TOTAL_CHAR_CAP
  let truncatedTotal = false

  for (const input of inputs) {
    const reason = sensitivePathReason(input.path)
    if (reason) {
      blockedFiles.push({ path: input.path, reason })
      continue
    }
    if (input.binary) {
      summarizedFiles.push({ path: input.path, note: 'binary file changed — not reviewed' })
      continue
    }
    if (isLockfilePath(input.path)) {
      const { added, removed } = countChanges(input.diff)
      summarizedFiles.push({
        path: input.path,
        note: `lockfile changed (${added}+ / ${removed}- lines) — not reviewed`,
      })
      continue
    }

    if (budget < MIN_USEFUL_SLICE) {
      summarizedFiles.push({ path: input.path, note: 'omitted — total review budget reached' })
      truncatedTotal = true
      continue
    }

    const cap = Math.min(PER_FILE_CHAR_CAP, budget)
    const { content, truncated } = sanitizeFileContent(input.diff, cap)
    if (truncated && cap < PER_FILE_CHAR_CAP) truncatedTotal = true
    budget -= content.length
    injectionSuspects.push(...findSuspects(input.path, content))
    files.push({ path: input.path, content, truncated, untracked: Boolean(input.untracked) })
  }

  const totalChars = files.reduce((n, f) => n + f.content.length, 0)
  return { files, blockedFiles, summarizedFiles, injectionSuspects, totalChars, truncatedTotal }
}

const DIFF_HEADER = /^diff --git "?a\/.*?"? "?b\/(.*?)"?$/

/**
 * Split a multi-file `git diff` patch into per-file inputs. Paths come from
 * the `b/` side (post-rename names). Robust to quoted paths and binary marks.
 */
export function parseUnifiedDiff(patch: string): DiffFileInput[] {
  if (!patch.trim()) return []
  const out: DiffFileInput[] = []
  let current: { path: string; lines: string[] } | null = null

  const flush = () => {
    if (!current) return
    const text = current.lines.join('\n')
    out.push({
      path: current.path,
      diff: text,
      binary: text.includes('Binary files ') || text.includes('GIT binary patch'),
    })
    current = null
  }

  for (const line of patch.split('\n')) {
    const header = DIFF_HEADER.exec(line)
    if (header) {
      flush()
      current = { path: header[1], lines: [line] }
    } else if (current) {
      current.lines.push(line)
    }
  }
  flush()
  return out
}
