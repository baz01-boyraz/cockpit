import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { MemoryHubService } from '../electron/main/services/MemoryHubService'
import type { ProjectService } from '../electron/main/services/ProjectService'

/** MemoryHubService only needs `projects.get(id).path` — stub exactly that. */
function stubProjects(path: string): ProjectService {
  return { get: () => ({ path }) } as unknown as ProjectService
}

describe('MemoryHubService snapshot / restore (G7)', () => {
  let projectPath: string
  let hub: MemoryHubService

  beforeEach(() => {
    projectPath = mkdtempSync(join(tmpdir(), 'cockpit-mem-'))
    hub = new MemoryHubService(stubProjects(projectPath))
  })

  afterEach(() => {
    rmSync(projectPath, { recursive: true, force: true })
  })

  it('snapshots the current notes and restores them after a bad change', () => {
    hub.write('p1', 'alpha', '# Alpha\n\noriginal alpha')
    hub.write('p1', 'beta', '# Beta\n\noriginal beta')

    const snap = hub.snapshot('p1')
    expect(snap.notes).toBe(2)

    // A bad consolidation: mangle alpha, add a junk note, remove beta.
    hub.write('p1', 'alpha', '# Alpha\n\nCORRUPTED')
    hub.write('p1', 'junk', '# Junk\n\nshould not survive restore')
    hub.trash('p1', 'beta')

    hub.restoreSnapshot('p1', snap.id)

    expect(hub.read('p1', 'alpha')?.content).toContain('original alpha')
    expect(hub.read('p1', 'beta')?.content).toContain('original beta')
    // the junk note added after the snapshot is gone from the live hub
    expect(hub.read('p1', 'junk')).toBeNull()
  })

  it('lists snapshots newest-first', () => {
    hub.write('p1', 'alpha', '# Alpha\n\nx')
    const a = hub.snapshot('p1')
    const b = hub.snapshot('p1')
    const list = hub.listSnapshots('p1')
    expect(list).toContain(a.id)
    expect(list).toContain(b.id)
  })

  it('rejects a path-shaped snapshot id', () => {
    expect(() => hub.restoreSnapshot('p1', '../../etc/passwd')).toThrow(/Invalid snapshot id/)
  })

  it('does not treat the snapshot dir as a note', () => {
    hub.write('p1', 'alpha', '# Alpha\n\nx')
    hub.snapshot('p1')
    const names = hub.list('p1').notes.map((n) => n.name)
    expect(names).toEqual(['alpha'])
  })
})
