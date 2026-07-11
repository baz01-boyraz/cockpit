#!/usr/bin/env node
import { createHash } from 'node:crypto'
import {
  lstatSync,
  readFileSync,
  readdirSync,
  realpathSync,
  statSync,
} from 'node:fs'
import { basename, join } from 'node:path'

const NOTE_CLASSES = new Set(['decision', 'gotcha', 'user', 'reference', 'architecture'])
const NOTE_GATES = new Set(['save', 'asked', 'manual', 'consolidation'])
const MAX_NOTE_BYTES = 1_000_000
const DUPLICATE_THRESHOLD = 0.72

function normalizeSlug(value) {
  if (typeof value !== 'string') return null
  const slug = value.trim().toLowerCase().replace(/\.md$/i, '')
  return /^[a-z0-9][a-z0-9._-]*$/.test(slug) && !slug.includes('..') ? slug : null
}

function parseFrontmatter(slug, content) {
  if (!content.startsWith('---\n') && !content.startsWith('---\r\n')) {
    return { status: 'absent', body: content }
  }
  const lines = content.split(/\r?\n/)
  const end = lines.slice(1).findIndex((line) => line.trim() === '---')
  if (end < 0) return { status: 'invalid', body: content }
  const closing = end + 1
  const raw = new Map()
  for (const line of lines.slice(1, closing)) {
    if (!line.trim()) continue
    const colon = line.indexOf(':')
    if (colon < 1) return { status: 'invalid', body: content }
    const key = line.slice(0, colon).trim()
    if (raw.has(key)) return { status: 'invalid', body: content }
    raw.set(key, line.slice(colon + 1).trim())
  }
  const schema = Number(raw.get('schema'))
  const updatedAt = raw.get('updatedAt')
  const valid =
    Number.isInteger(schema) &&
    schema > 0 &&
    schema <= 1 &&
    normalizeSlug(raw.get('name')) === slug &&
    typeof raw.get('title') === 'string' &&
    raw.get('title').length > 0 &&
    raw.get('title').length <= 200 &&
    NOTE_CLASSES.has(raw.get('class')) &&
    NOTE_GATES.has(raw.get('gate')) &&
    typeof updatedAt === 'string' &&
    !Number.isNaN(Date.parse(updatedAt))
  return {
    status: valid ? 'valid' : 'invalid',
    body: lines.slice(closing + 1).join('\n').replace(/^\n+/, ''),
  }
}

function tokenSet(text) {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, ' ')
      .trim()
      .split(/\s+/)
      .filter((word) => word.length > 2),
  )
}

function similarity(a, b) {
  const left = tokenSet(a)
  const right = tokenSet(b)
  if (left.size === 0 || right.size === 0) return 0
  let intersection = 0
  for (const token of left) if (right.has(token)) intersection += 1
  const union = left.size + right.size - intersection
  return union === 0 ? 0 : intersection / union
}

function normalizeFact(line) {
  return line
    .replace(/^[-*+]\s+/, '')
    .replace(/^\(\d{4}-\d{2}-\d{2}\)\s*/, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
}

function repeatedFacts(name, body) {
  const counts = new Map()
  for (const line of body.split(/\r?\n/)) {
    if (!/^[-*+]\s+/.test(line.trim())) continue
    const fact = normalizeFact(line.trim())
    if (!fact) continue
    counts.set(fact, (counts.get(fact) ?? 0) + 1)
  }
  return [...counts.values()]
    .filter((count) => count > 1)
    .map((count) => ({ note: name, count }))
}

function linksIn(content) {
  const links = new Set()
  const re = /\[\[([^\]|#]+)(?:[|#][^\]]*)?\]\]/g
  for (const match of content.matchAll(re)) {
    const slug = normalizeSlug(match[1].replace(/\s+/g, '-'))
    if (slug) links.add(slug)
  }
  return [...links]
}

function latestSnapshot(hub) {
  const dir = join(hub, '.snapshots')
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort()
      .at(-1) ?? null
  } catch {
    return null
  }
}

function pendingReviews(path) {
  if (!path) return null
  const parsed = JSON.parse(readFileSync(path, 'utf8'))
  const items = Array.isArray(parsed) ? parsed : parsed?.items
  if (!Array.isArray(items)) throw new Error('--reviews JSON must be an array or {items:[]}')
  return items.filter((item) => item?.status === 'pending').length
}

/** Build a deterministic, content-free, read-only manifest for one memory hub. */
export function buildMemoryManifest(hubPath, reviewsPath = null) {
  const hub = realpathSync(hubPath)
  if (!statSync(hub).isDirectory()) throw new Error('--hub must point to a directory')
  const entries = readdirSync(hub, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))
  const ignoredSymlinks = []
  const ignoredForeignEntries = []
  const ignoredOversizedNotes = []
  const docs = []

  for (const entry of entries) {
    const path = join(hub, entry.name)
    if (lstatSync(path).isSymbolicLink()) {
      ignoredSymlinks.push(entry.name)
      continue
    }
    if (!entry.isFile() || !entry.name.endsWith('.md')) continue
    const slug = normalizeSlug(entry.name)
    if (!slug || `${slug}.md` !== entry.name) {
      ignoredForeignEntries.push(entry.name)
      continue
    }
    const bytes = statSync(path).size
    if (bytes > MAX_NOTE_BYTES) {
      ignoredOversizedNotes.push(slug)
      continue
    }
    const content = readFileSync(path, 'utf8')
    const parsed = parseFrontmatter(slug, content)
    docs.push({
      name: slug,
      bytes,
      sha256: createHash('sha256').update(content).digest('hex'),
      frontmatter: parsed.status,
      body: parsed.body,
      links: linksIn(content),
    })
  }

  const known = new Set(docs.map((doc) => doc.name))
  const unresolved = new Map()
  for (const doc of docs) {
    for (const target of doc.links) {
      if (target === doc.name || known.has(target)) continue
      const wantedBy = unresolved.get(target) ?? new Set()
      wantedBy.add(doc.name)
      unresolved.set(target, wantedBy)
    }
  }

  const duplicateCandidates = []
  for (let left = 0; left < docs.length; left += 1) {
    for (let right = left + 1; right < docs.length; right += 1) {
      const score = similarity(docs[left].body, docs[right].body)
      if (score >= DUPLICATE_THRESHOLD) {
        duplicateCandidates.push({
          notes: [docs[left].name, docs[right].name],
          similarity: Number(score.toFixed(4)),
        })
      }
    }
  }
  duplicateCandidates.sort((a, b) => b.similarity - a.similarity || a.notes[0].localeCompare(b.notes[0]))

  const reportNotes = docs.map(({ name, bytes, sha256, frontmatter }) => ({
    name,
    bytes,
    sha256,
    frontmatter,
  }))
  return {
    schemaVersion: 1,
    hubName: basename(hub),
    noteCount: docs.length,
    totalBytes: docs.reduce((sum, doc) => sum + doc.bytes, 0),
    latestSnapshotId: latestSnapshot(hub),
    pendingReviewCount: pendingReviews(reviewsPath),
    invalidFrontmatter: docs.filter((doc) => doc.frontmatter === 'invalid').map((doc) => doc.name),
    frontmatterless: docs.filter((doc) => doc.frontmatter === 'absent').map((doc) => doc.name),
    repeatedFacts: docs.flatMap((doc) => repeatedFacts(doc.name, doc.body)),
    unresolvedLinks: [...unresolved.entries()]
      .map(([target, wantedBy]) => ({ target, wantedBy: [...wantedBy].sort() }))
      .sort((a, b) => a.target.localeCompare(b.target)),
    duplicateCandidates,
    ignoredSymlinks,
    ignoredForeignEntries,
    ignoredOversizedNotes,
    notes: reportNotes,
  }
}

function parseArgs(argv) {
  let hub = null
  let reviews = null
  let pretty = false
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--hub') hub = argv[++i] ?? null
    else if (argv[i] === '--reviews') reviews = argv[++i] ?? null
    else if (argv[i] === '--pretty') pretty = true
    else if (argv[i] === '--help') return { help: true, hub: null, reviews: null, pretty: false }
    else throw new Error(`unknown argument: ${argv[i]}`)
  }
  if (!hub) throw new Error('--hub <directory> is required')
  return { help: false, hub, reviews, pretty }
}

function main() {
  try {
    const args = parseArgs(process.argv.slice(2))
    if (args.help) {
      process.stdout.write('Usage: node scripts/diagnostics/memory-manifest.mjs --hub <.cockpit-memory> [--reviews <json>] [--pretty]\n')
      return
    }
    const report = buildMemoryManifest(args.hub, args.reviews)
    process.stdout.write(`${JSON.stringify(report, null, args.pretty ? 2 : 0)}\n`)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown error'
    process.stderr.write(`memory-manifest: ${message}\n`)
    process.exitCode = 1
  }
}

if (process.argv[1]?.endsWith('memory-manifest.mjs')) main()
