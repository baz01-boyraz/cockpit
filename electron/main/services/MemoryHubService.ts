import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { randomUUID } from 'node:crypto'
import { join, resolve, sep } from 'node:path'
import { normalizeNoteName, renameLinkTargets } from '@shared/wikilink'
import {
  assembleHubSnapshot,
  assembleNote,
  type MemoryDoc,
  type MemoryHubSnapshot,
  type MemoryNote,
} from '@shared/memory-hub'
import { assembleHealth, type MemoryHealth } from '@shared/memory-health'
import type { ProjectService } from './ProjectService'

const HUB_DIR = '.cockpit-memory'
const TRASH_DIR = '.trash'
const SNAPSHOT_DIR = '.snapshots'
const MAX_NOTE_CHARS = 500_000

/**
 * The per-project markdown knowledge hub (VISION Phase 5). Files are the only
 * source of truth — this service is a thin, path-safe fs layer plus the shared
 * pure assembly. Note names are slugs by construction (normalizeNoteName), so
 * a traversal path is unrepresentable; the resolve() guard is defense in
 * depth. Deletion is a soft move into `.trash/` — never destructive.
 */
export class MemoryHubService {
  /**
   * `fixedRoot`, when given, makes this a single-hub service rooted at that
   * directory regardless of the `projectId` argument — how the global "Baz
   * brain" (docs/memory-imp.md Phase 6) reuses the exact same machinery at
   * `<userData>/baz-memory/`. Without it, the hub is per-project as before.
   */
  constructor(
    private readonly projects: ProjectService,
    private readonly fixedRoot?: string,
  ) {}

  private hubDir(projectId: string): string {
    const base = this.fixedRoot ?? this.projects.get(projectId).path
    return join(base, HUB_DIR)
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

  /** Raw docs (name + content + mtime) — for the pipeline's reconciliation. */
  listDocs(projectId: string): MemoryDoc[] {
    return this.readDocs(projectId)
  }

  read(projectId: string, name: string): MemoryNote | null {
    return assembleNote(this.readDocs(projectId), name)
  }

  /** Brain health snapshot (memory-imp G6) — derived from the same docs. */
  health(projectId: string): MemoryHealth {
    return assembleHealth(this.readDocs(projectId))
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

  /** Top-level note filenames (`<slug>.md`) in a hub directory. */
  private noteFiles(hub: string): string[] {
    let entries: string[]
    try {
      entries = readdirSync(hub)
    } catch {
      return []
    }
    return entries.filter((e) => {
      if (!e.endsWith('.md')) return false
      const slug = normalizeNoteName(e)
      return !!slug && `${slug}.md` === e
    })
  }

  /**
   * Snapshot the whole hub before a bulk/maintenance pass (memory-imp G7). Copies
   * every top-level note into `.snapshots/<stamp>/`; returns the snapshot id so a
   * later `restoreSnapshot` can undo a bad consolidation. Reserved dirs (`.trash`,
   * `.snapshots`) are never copied.
   */
  snapshot(projectId: string): { id: string; notes: number } {
    const hub = this.hubDir(projectId)
    const id = `${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`
    const dest = join(hub, SNAPSHOT_DIR, id)
    mkdirSync(dest, { recursive: true })
    const files = this.noteFiles(hub)
    for (const file of files) {
      copyFileSync(join(hub, file), join(dest, file))
    }
    return { id, notes: files.length }
  }

  listSnapshots(projectId: string): string[] {
    const dir = join(this.hubDir(projectId), SNAPSHOT_DIR)
    try {
      return readdirSync(dir)
        .filter((e) => existsSync(join(dir, e)))
        .sort()
        .reverse()
    } catch {
      return []
    }
  }

  /**
   * Restore the hub to a snapshot (memory-imp G7). Notes in the snapshot are
   * written back verbatim; live notes that were NOT in the snapshot are soft-
   * deleted to `.trash/` — never hard-removed. A bad merge is one call to undo.
   */
  restoreSnapshot(projectId: string, snapshotId: string): MemoryHubSnapshot {
    // Snapshot ids are `<iso-with-dashes>-<8 hex>` by construction — anything
    // path-shaped (separators, `..`) is rejected before it touches the fs.
    if (!/^[0-9A-Za-z.-]+-[a-f0-9]{8}$/.test(snapshotId) || snapshotId.includes('..')) {
      throw new Error('Invalid snapshot id.')
    }
    const hub = this.hubDir(projectId)
    const src = join(hub, SNAPSHOT_DIR, snapshotId)
    const snapResolved = resolve(src)
    if (!snapResolved.startsWith(resolve(join(hub, SNAPSHOT_DIR)) + sep)) {
      throw new Error('Snapshot path escapes the hub.')
    }
    const snapFiles = this.noteFiles(src)
    const snapSlugs = new Set(snapFiles.map((f) => normalizeNoteName(f)!))

    // Soft-delete live notes absent from the snapshot.
    const trashDir = join(hub, TRASH_DIR)
    for (const file of this.noteFiles(hub)) {
      const slug = normalizeNoteName(file)!
      if (snapSlugs.has(slug)) continue
      mkdirSync(trashDir, { recursive: true })
      const stamp = new Date().toISOString().replace(/[:.]/g, '-')
      renameSync(join(hub, file), join(trashDir, `${slug}-restore-${stamp}.md`))
    }
    // Write snapshot notes back over the hub.
    for (const file of snapFiles) {
      copyFileSync(join(src, file), join(hub, file))
    }
    return this.list(projectId)
  }
}
