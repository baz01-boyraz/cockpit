import { createHash } from 'node:crypto'
import { constants } from 'node:fs'
import { lstat, open, readFile, readdir, realpath } from 'node:fs/promises'
import { basename, extname, join, relative, sep } from 'node:path'
import {
  findInjectionSuspects,
  isLockfilePath,
  sensitivePathReason,
} from '@shared/diff-sanitize'
import {
  COUNCIL_EVIDENCE_LIMITS,
  COUNCIL_EVIDENCE_SCHEMA_VERSION,
  normalizeCouncilEvidencePack,
  type CouncilEvidencePack,
  type CouncilEvidenceSource,
} from '@shared/council-evidence'
import type { MemoryContextReceipt } from '@shared/memory-context'
import { redactText } from '@shared/redaction'

export interface CouncilEvidenceCollectInput {
  root: string
  query: string
  memoryReceipt?: MemoryContextReceipt
}

export interface CouncilEvidenceCollector {
  collect(input: CouncilEvidenceCollectInput): Promise<CouncilEvidencePack>
}

export interface CouncilEvidenceCollectorLimits {
  maxFilesVisited: number
  maxFilesRead: number
  maxFileBytes: number
  maxSources: number
  perSourceChars: number
  totalChars: number
}

const DEFAULT_LIMITS: CouncilEvidenceCollectorLimits = {
  maxFilesVisited: 2_000,
  maxFilesRead: 160,
  maxFileBytes: 128_000,
  maxSources: 16,
  perSourceChars: COUNCIL_EVIDENCE_LIMITS.sourceContentChars,
  totalChars: COUNCIL_EVIDENCE_LIMITS.totalChars,
}

const IGNORED_DIRECTORIES = new Set([
  '.agents',
  '.cache',
  '.claude',
  '.cockpit-worktrees',
  '.codex',
  '.git',
  '.cockpit-memory',
  '.dev-cockpit',
  '.hermes',
  '.next',
  '.playwright-cli',
  '.playwright-mcp',
  '.turbo',
  'build',
  'coverage',
  'dist',
  'dist-electron',
  'node_modules',
  'out',
  'output',
  'playwright-report',
  'release',
  'test-results',
])

function ignoredDirectory(name: string): boolean {
  const lower = name.toLocaleLowerCase()
  return IGNORED_DIRECTORIES.has(lower) || lower === 'node_modules' || lower.startsWith('node_modules.')
}

const TEXT_EXTENSIONS = new Set([
  '.c', '.cc', '.cpp', '.css', '.go', '.graphql', '.h', '.hpp', '.html', '.java',
  '.js', '.json', '.jsx', '.kt', '.kts', '.md', '.mjs', '.php', '.prisma', '.py',
  '.rb', '.rs', '.scss', '.sh', '.sql', '.svelte', '.swift', '.toml', '.ts', '.tsx',
  '.vue', '.xml', '.yaml', '.yml', '.zsh',
])

const IMPORTANT_TEXT_FILES = new Set([
  'agents.md',
  'claude.md',
  'dockerfile',
  'gemfile',
  'makefile',
  'package.json',
  'readme',
  'readme.md',
  'tsconfig.json',
])

const STOP_WORDS = new Set([
  'about', 'after', 'again', 'also', 'analysis', 'analyze', 'and', 'are', 'bir', 'bu',
  'icin', 'için', 'ile', 'into', 'memory', 'nasil', 'nasıl', 'repository', 'sistem',
  'system', 'that', 'the', 'this', 've', 'what', 'with',
])

interface Candidate {
  path: string
  absolute: string
  pathScore: number
}

interface ScoredCandidate extends Candidate {
  content: string
  hash: string
  score: number
  injectionSuspect: boolean
}

function sha256(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex')
}

function cleanRelative(root: string, absolute: string): string | null {
  const rel = relative(root, absolute).split(sep).join('/')
  return !rel || rel === '..' || rel.startsWith('../') || rel.startsWith('/') ? null : rel
}

function queryTokens(query: string): string[] {
  const raw = query.toLocaleLowerCase().match(/[\p{L}\p{N}_-]{2,}/gu) ?? []
  const expanded = raw.flatMap((token) => [token, ...token.split(/[_-]+/)])
  return [...new Set(expanded.filter((token) => token.length >= 2 && !STOP_WORDS.has(token)))].slice(0, 32)
}

function occurrences(value: string, token: string): number {
  let count = 0
  let cursor = 0
  while (count < 12) {
    const next = value.indexOf(token, cursor)
    if (next < 0) break
    count += 1
    cursor = next + token.length
  }
  return count
}

function pathScore(path: string, tokens: readonly string[]): number {
  const lower = path.toLocaleLowerCase()
  const base = basename(lower, extname(lower))
  return tokens.reduce(
    (score, token) => score + occurrences(lower, token) * 16 + (base === token ? 24 : 0),
    0,
  )
}

function authorityScore(path: string): number {
  const lower = path.toLocaleLowerCase()
  if (lower.startsWith('shared/') || lower.startsWith('electron/') || lower.startsWith('src/')) {
    return 18
  }
  if (lower.startsWith('test/') || lower.startsWith('e2e/')) return 3
  if (lower.startsWith('docs/plans/')) return -14
  if (lower.startsWith('docs/') || extname(lower) === '.md') return -8
  return 0
}

function isTextCandidate(path: string): boolean {
  const base = basename(path).toLocaleLowerCase()
  return IMPORTANT_TEXT_FILES.has(base) || TEXT_EXTENSIONS.has(extname(base))
}

function binaryLike(buffer: Buffer): boolean {
  return buffer.includes(0)
}

function safeLimit(value: number | undefined, fallback: number, min: number, max: number): number {
  return Number.isInteger(value) && (value ?? 0) >= min
    ? Math.min(value!, max)
    : fallback
}

async function readBoundedRegularFile(
  root: string,
  absolute: string,
  maxBytes: number,
): Promise<Buffer | null> {
  const resolved = await realpath(absolute).catch(() => null)
  if (resolved !== absolute || !cleanRelative(root, resolved)) return null
  const handle = await open(
    absolute,
    constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0),
  ).catch(() => null)
  if (!handle) return null
  try {
    const stat = await handle.stat()
    if (!stat.isFile() || stat.size > maxBytes) return null
    const target = Buffer.alloc(Math.max(0, stat.size))
    let offset = 0
    while (offset < target.length) {
      const { bytesRead } = await handle.read(target, offset, target.length - offset, offset)
      if (bytesRead === 0) break
      offset += bytesRead
    }
    return target.subarray(0, offset)
  } finally {
    await handle.close().catch(() => undefined)
  }
}

function boundedText(value: string, cap: number): { text: string; truncated: boolean } {
  const clean = value.trim()
  if (clean.length <= cap) return { text: clean, truncated: false }
  const marker = '…[truncated]'
  if (cap <= marker.length) return { text: marker.slice(0, cap), truncated: true }
  return {
    text: `${clean.slice(0, cap - marker.length).trimEnd()}${marker}`,
    truncated: true,
  }
}

function bestSnippet(
  content: string,
  tokens: readonly string[],
  cap: number,
): { content: string; startLine: number; endLine: number; truncated: boolean } {
  const lines = content.replace(/\r\n?/g, '\n').split('\n')
  let bestIndex = 0
  let bestScore = -1
  lines.forEach((line, index) => {
    const lower = line.toLocaleLowerCase()
    const score = tokens.reduce((sum, token) => sum + occurrences(lower, token), 0)
    if (score > bestScore) {
      bestScore = score
      bestIndex = index
    }
  })
  const from = Math.max(0, bestIndex - 8)
  const to = Math.min(lines.length, bestIndex + 13)
  const bounded = boundedText(lines.slice(from, to).join('\n'), cap)
  return {
    content: bounded.text,
    startLine: from + 1,
    endLine: to,
    truncated: bounded.truncated || from > 0 || to < lines.length,
  }
}

function safeHeadRef(root: string): Promise<string | null> {
  return readFile(join(root, '.git', 'HEAD'), 'utf8')
    .then((value) => {
      const clean = value.trim()
      if (/^ref:\s+refs\/[A-Za-z0-9._/-]+$/.test(clean)) return clean.replace(/^ref:\s+/, '')
      if (/^[a-f0-9]{40,64}$/i.test(clean)) return clean.slice(0, 16)
      return null
    })
    .catch(() => null)
}

/**
 * Read-only repository evidence collector. It never shells out, never follows
 * symlinks, never reads Memory note bodies, and emits only bounded redacted
 * snippets with relative paths + hashes.
 */
export class CouncilEvidenceService implements CouncilEvidenceCollector {
  private readonly limits: CouncilEvidenceCollectorLimits

  constructor(limits: Partial<CouncilEvidenceCollectorLimits> = {}) {
    this.limits = {
      maxFilesVisited: safeLimit(limits.maxFilesVisited, DEFAULT_LIMITS.maxFilesVisited, 1, 20_000),
      maxFilesRead: safeLimit(limits.maxFilesRead, DEFAULT_LIMITS.maxFilesRead, 1, 1_000),
      maxFileBytes: safeLimit(limits.maxFileBytes, DEFAULT_LIMITS.maxFileBytes, 1_024, 512_000),
      maxSources: safeLimit(
        limits.maxSources,
        DEFAULT_LIMITS.maxSources,
        2,
        COUNCIL_EVIDENCE_LIMITS.maxSources,
      ),
      perSourceChars: safeLimit(
        limits.perSourceChars,
        DEFAULT_LIMITS.perSourceChars,
        80,
        COUNCIL_EVIDENCE_LIMITS.sourceContentChars,
      ),
      totalChars: safeLimit(
        limits.totalChars,
        DEFAULT_LIMITS.totalChars,
        256,
        COUNCIL_EVIDENCE_LIMITS.totalChars,
      ),
    }
  }

  async collect(input: CouncilEvidenceCollectInput): Promise<CouncilEvidencePack> {
    const root = await realpath(input.root)
    const tokens = queryTokens(input.query)
    const candidates: Candidate[] = []
    const manifest: string[] = []
    let filesVisited = 0
    let entriesVisited = 0
    let filesRead = 0
    let traversalTruncated = false

    const walk = async (directory: string): Promise<void> => {
      if (entriesVisited >= this.limits.maxFilesVisited) {
        traversalTruncated = true
        return
      }
      const entries = await readdir(directory, { withFileTypes: true }).catch(() => [])
      entries.sort((a, b) => a.name.localeCompare(b.name))
      for (const entry of entries) {
        if (entriesVisited >= this.limits.maxFilesVisited) {
          traversalTruncated = true
          return
        }
        entriesVisited += 1
        if (entry.isSymbolicLink()) continue
        const absolute = join(directory, entry.name)
        const rel = cleanRelative(root, absolute)
        if (!rel) continue
        if (entry.isDirectory()) {
          if (!ignoredDirectory(entry.name)) await walk(absolute)
          continue
        }
        if (!entry.isFile()) continue
        filesVisited += 1
        manifest.push(rel)
        if (
          sensitivePathReason(rel) ||
          isLockfilePath(rel) ||
          !isTextCandidate(rel)
        ) continue
        const stat = await lstat(absolute).catch(() => null)
        if (!stat?.isFile() || stat.size > this.limits.maxFileBytes) continue
        candidates.push({
          path: rel,
          absolute,
          pathScore: pathScore(rel, tokens),
        })
      }
    }
    await walk(root)

    const readOrder = [...candidates].sort(
      (a, b) => b.pathScore - a.pathScore || a.path.localeCompare(b.path),
    )
    const scored: ScoredCandidate[] = []
    for (const candidate of readOrder.slice(0, this.limits.maxFilesRead)) {
      const buffer = await readBoundedRegularFile(
        root,
        candidate.absolute,
        this.limits.maxFileBytes,
      )
      if (!buffer || binaryLike(buffer)) continue
      filesRead += 1
      const raw = buffer.toString('utf8')
      const redacted = redactText(raw)
      const lower = redacted.toLocaleLowerCase()
      const contentWeight = extname(candidate.path).toLocaleLowerCase() === '.md' ? 1 : 4
      const contentScore = tokens.reduce(
        (score, token) => {
          const count = occurrences(lower, token)
          return score + (count > 0 ? contentWeight * (1 + Math.min(count, 3)) : 0)
        },
        0,
      )
      const relevanceScore = candidate.pathScore + contentScore
      if (tokens.length > 0 && relevanceScore <= 0) continue
      const score = relevanceScore + authorityScore(candidate.path)
      scored.push({
        ...candidate,
        content: redacted,
        hash: sha256(buffer),
        score,
        injectionSuspect: findInjectionSuspects(candidate.path, redacted).length > 0,
      })
    }
    scored.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path))

    const sources: CouncilEvidenceSource[] = []
    let totalChars = 0
    let sourceTruncated = false
    const addContent = (content: string): string | null => {
      const room = this.limits.totalChars - totalChars
      if (room <= 0) return null
      const bounded = boundedText(content, room)
      totalChars += bounded.text.length
      if (bounded.truncated) sourceTruncated = true
      return bounded.text
    }
    const inputContent = addContent(
      boundedText(redactText(input.query), Math.min(1_000, this.limits.perSourceChars)).text,
    )
    if (inputContent) {
      sources.push({
        id: 'input-001',
        kind: 'input',
        label: 'User analysis request',
        path: null,
        content: inputContent,
        startLine: null,
        endLine: null,
        sha256: null,
        updatedAt: null,
        truncated: inputContent.length < input.query.trim().length,
        injectionSuspect: findInjectionSuspects('user-request', inputContent).length > 0,
      })
    }

    const memoryNotes = (input.memoryReceipt?.notes ?? []).slice(
      0,
      Math.max(0, this.limits.maxSources - sources.length),
    )
    const repositorySlots = Math.max(
      0,
      this.limits.maxSources - sources.length - memoryNotes.length,
    )
    let repoIndex = 0
    for (const candidate of scored.slice(0, repositorySlots)) {
      if (sources.length >= this.limits.maxSources) break
      const snippet = bestSnippet(candidate.content, tokens, this.limits.perSourceChars)
      const content = addContent(snippet.content)
      if (!content) break
      repoIndex += 1
      sources.push({
        id: `repo-${String(repoIndex).padStart(3, '0')}`,
        kind: 'repository',
        label: `${candidate.path}:${snippet.startLine}-${snippet.endLine}`,
        path: candidate.path,
        content,
        startLine: snippet.startLine,
        endLine: snippet.endLine,
        sha256: candidate.hash,
        updatedAt: null,
        truncated: snippet.truncated || content.length < snippet.content.length,
        injectionSuspect: candidate.injectionSuspect,
      })
    }

    let memoryIndex = 0
    for (const note of memoryNotes) {
      if (sources.length >= this.limits.maxSources) break
      memoryIndex += 1
      sources.push({
        id: `memory-${String(memoryIndex).padStart(3, '0')}`,
        kind: 'memory',
        label: note.path,
        path: note.path,
        content: null,
        startLine: null,
        endLine: null,
        sha256: null,
        updatedAt: note.updatedAt,
        truncated: note.truncated,
        injectionSuspect: false,
      })
    }

    const canonicalMemoryMdPresent = manifest.some(
      (path) => path.toLocaleLowerCase() === 'memory.md',
    )
    const unknowns: string[] = []
    if (!canonicalMemoryMdPresent) {
      unknowns.push('No canonical MEMORY.md exists in the scanned repository manifest.')
    }
    if (scored.length === 0) unknowns.push('No repository source positively matched the request.')
    if (traversalTruncated) unknowns.push('Repository traversal stopped at the configured file cap.')
    if (scored.length > repoIndex || sourceTruncated) {
      unknowns.push('Some matching repository evidence was omitted by source or character caps.')
    }
    const injectionCount = sources.filter((source) => source.injectionSuspect).length
    if (injectionCount > 0) {
      unknowns.push(`${injectionCount} source(s) contained instruction-like text and were fenced as data.`)
    }
    const pack: CouncilEvidencePack = {
      schemaVersion: COUNCIL_EVIDENCE_SCHEMA_VERSION,
      repository: {
        workspaceHash: sha256(root),
        manifestHash: sha256([...manifest].sort().join('\n')),
        headRef: await safeHeadRef(root),
        filesVisited,
        filesRead,
        canonicalMemoryMdPresent,
      },
      sources,
      unknowns,
      totalChars,
      truncated: traversalTruncated || scored.length > repoIndex || sourceTruncated,
    }
    const normalized = normalizeCouncilEvidencePack(pack)
    if (!normalized) throw new Error('Council evidence collector produced an invalid pack.')
    return normalized
  }
}
