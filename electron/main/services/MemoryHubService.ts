import { mkdirSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { join, resolve, sep } from 'node:path'
import { normalizeNoteName, renameLinkTargets } from '@shared/wikilink'
import {
  assembleHubSnapshot,
  assembleNote,
  type MemoryDoc,
  type MemoryHubSnapshot,
  type MemoryNote,
} from '@shared/memory-hub'
import type { ProjectService } from './ProjectService'

const HUB_DIR = '.cockpit-memory'
const TRASH_DIR = '.trash'
const MAX_NOTE_CHARS = 500_000

/**
 * The per-project markdown knowledge hub (VISION Phase 5). Files are the only
 * source of truth — this service is a thin, path-safe fs layer plus the shared
 * pure assembly. Note names are slugs by construction (normalizeNoteName), so
 * a traversal path is unrepresentable; the resolve() guard is defense in
 * depth. Deletion is a soft move into `.trash/` — never destructive.
 */
export class MemoryHubService {
  constructor(private readonly projects: ProjectService) {}

  private hubDir(projectId: string): string {
    return join(this.projects.get(projectId).path, HUB_DIR)
  }

  /** Resolve a slug to its file path, refusing anything outside the hub. */
  private notePath(hub: string, slug: string): string {
    const path = resolve(hub, `${slug}.md`)
    if (!path.startsWith(resolve(hub) + sep)) {
      throw new Error('Note path escapes the memory hub.')
    }
    return path
  }

  private requireSlug(raw: string): string {
    const slug = normalizeNoteName(raw)
    if (!slug) throw new Error(`Invalid note name: ${JSON.stringify(raw)}`)
    return slug
  }

  private readDocs(projectId: string): MemoryDoc[] {
    const hub = this.hubDir(projectId)
    let entries: string[]
    try {
      entries = readdirSync(hub)
    } catch {
      return []
    }
    const docs: MemoryDoc[] = []
    for (const entry of entries) {
      if (!entry.endsWith('.md')) continue
      const slug = normalizeNoteName(entry)
      if (!slug || `${slug}.md` !== entry) continue // foreign filenames are ignored, never touched
      try {
        const path = this.notePath(hub, slug)
        const st = statSync(path)
        if (st.size > MAX_NOTE_CHARS * 2) continue
        docs.push({
          name: slug,
          content: readFileSync(path, 'utf8'),
          updatedAt: st.mtime.toISOString(),
        })
      } catch {
        continue
      }
    }
    return docs
  }

  list(projectId: string): MemoryHubSnapshot {
    return assembleHubSnapshot(this.readDocs(projectId))
  }

  read(projectId: string, name: string): MemoryNote | null {
    return assembleNote(this.readDocs(projectId), name)
  }

  write(projectId: string, name: string, content: string): MemoryNote {
    const slug = this.requireSlug(name)
    if (content.length > MAX_NOTE_CHARS) {
      throw new Error('Note is too large — split it up.')
    }
    const hub = this.hubDir(projectId)
    mkdirSync(hub, { recursive: true })
    const path = this.notePath(hub, slug)
    // Atomic-enough on one filesystem: write sibling tmp, then rename over.
    const tmp = this.notePath(hub, `${slug}.tmp-write`)
    writeFileSync(tmp, content, 'utf8')
    renameSync(tmp, path)
    const note = this.read(projectId, slug)
    if (!note) throw new Error('Note write could not be read back.')
    return note
  }

  /** Rename a note and refresh every `[[link]]` pointing at it. */
  rename(projectId: string, from: string, to: string): MemoryHubSnapshot {
    const fromSlug = this.requireSlug(from)
    const toSlug = this.requireSlug(to)
    if (fromSlug === toSlug) return this.list(projectId)
    const hub = this.hubDir(projectId)
    const fromPath = this.notePath(hub, fromSlug)
    const toPath = this.notePath(hub, toSlug)
    if (this.read(projectId, toSlug)) {
      throw new Error(`A note named "${toSlug}" already exists.`)
    }
    renameSync(fromPath, toPath)
    for (const doc of this.readDocs(projectId)) {
      if (doc.name === toSlug) continue
      const refreshed = renameLinkTargets(doc.content, fromSlug, toSlug)
      if (refreshed !== doc.content) {
        writeFileSync(this.notePath(hub, doc.name), refreshed, 'utf8')
      }
    }
    return this.list(projectId)
  }

  /** Soft delete: move into `.trash/` with a timestamp — recoverable by hand. */
  trash(projectId: string, name: string): MemoryHubSnapshot {
    const slug = this.requireSlug(name)
    const hub = this.hubDir(projectId)
    const trashDir = join(hub, TRASH_DIR)
    mkdirSync(trashDir, { recursive: true })
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    renameSync(this.notePath(hub, slug), join(trashDir, `${slug}-${stamp}.md`))
    return this.list(projectId)
  }
}
