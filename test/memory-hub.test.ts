import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { MemoryHubService } from '../electron/main/services/MemoryHubService'
import type { ProjectService } from '../electron/main/services/ProjectService'
import { serializeNote, type NoteFrontmatter } from '@shared/memory-note-schema'

const roots: string[] = []
function makeHubProject(): { service: MemoryHubService; dir: string; hub: string } {
  const dir = mkdtempSync(join(tmpdir(), 'cockpit-hub-'))
  roots.push(dir)
  const projects = { get: vi.fn(() => ({ id: 'prj_1', name: 'x', path: dir })) } as unknown as ProjectService
  return { service: new MemoryHubService(projects), dir, hub: join(dir, '.cockpit-memory') }
}
afterAll(() => {
  for (const dir of roots) rmSync(dir, { recursive: true, force: true })
})

describe('MemoryHubService', () => {
  it('keeps archived/superseded notes browsable but excludes them from active retrieval', () => {
    const { service } = makeHubProject()
    const note = (name: string, status: NoteFrontmatter['status']) =>
      serializeNote({
        schema: 2,
        name,
        title: name,
        class: 'reference',
        gate: 'manual',
        updatedAt: '2026-07-12T00:00:00.000Z',
        tags: [],
        status,
        authority: 'human-directive',
        scope: 'project',
        confidence: 'high',
        firstSeenAt: '2026-07-12T00:00:00.000Z',
        reviewAfter: '2027-01-01T00:00:00.000Z',
        supersedes: [],
      }, 'durable fact')
    service.write('prj_1', 'active-note', note('active-note', 'active'))
    service.write('prj_1', 'archived-note', note('archived-note', 'archived'))
    service.write('prj_1', 'superseded-note', note('superseded-note', 'superseded'))

    expect(service.list('prj_1').notes).toHaveLength(3)
    expect(service.read('prj_1', 'archived-note')).not.toBeNull()
    expect(service.listDocs('prj_1').map((doc) => doc.name)).toEqual(['active-note'])
  })

  it('writes, lists, and reads notes with backlinks and unresolved targets', () => {
    const { service } = makeHubProject()
    service.write('prj_1', 'Auth Flow', '# Auth Flow\nuses [[session-store]] and [[ghost]]')
    service.write('prj_1', 'session-store', 'referenced by [[auth-flow]]')

    const snapshot = service.list('prj_1')
    expect(snapshot.notes.map((n) => n.name).sort()).toEqual(['auth-flow', 'session-store'])
    expect(snapshot.notes.find((n) => n.name === 'auth-flow')?.title).toBe('Auth Flow')
    expect(snapshot.unresolved).toEqual([{ target: 'ghost', wantedBy: ['auth-flow'] }])

    const note = service.read('prj_1', 'AUTH FLOW.md')
    expect(note?.name).toBe('auth-flow')
    expect(note?.backlinks).toEqual(['session-store'])
    expect(note?.outgoing).toEqual(['session-store'])
    expect(note?.unresolved).toEqual(['ghost'])
  })

  it('returns an empty snapshot for a project with no hub, and null for missing notes', () => {
    const { service } = makeHubProject()
    expect(service.list('prj_1')).toEqual({ notes: [], unresolved: [] })
    expect(service.read('prj_1', 'nope')).toBeNull()
  })

  it('refuses traversal-shaped and invalid names', () => {
    const { service } = makeHubProject()
    expect(() => service.write('prj_1', '../evil', 'x')).toThrow(/invalid note name/i)
    expect(() => service.write('prj_1', '.hidden', 'x')).toThrow(/invalid note name/i)
    expect(() => service.write('prj_1', 'a/b', 'x')).toThrow(/invalid note name/i)
    expect(service.read('prj_1', '../../etc/passwd')).toBeNull()
  })

  it('rename refreshes links in every other note and refuses collisions', () => {
    const { service, hub } = makeHubProject()
    service.write('prj_1', 'old-note', 'the target')
    service.write('prj_1', 'caller-a', 'see [[old-note]] twice [[Old Note|alias kept]]')
    service.write('prj_1', 'caller-b', 'unrelated [[other]]')

    const snapshot = service.rename('prj_1', 'old-note', 'new-note')
    expect(snapshot.notes.map((n) => n.name).sort()).toEqual(['caller-a', 'caller-b', 'new-note'])
    const callerA = readFileSync(join(hub, 'caller-a.md'), 'utf8')
    expect(callerA).toBe('see [[new-note]] twice [[new-note|alias kept]]')
    const callerB = readFileSync(join(hub, 'caller-b.md'), 'utf8')
    expect(callerB).toBe('unrelated [[other]]')

    service.write('prj_1', 'occupied', 'x')
    expect(() => service.rename('prj_1', 'new-note', 'occupied')).toThrow(/already exists/i)
  })

  it('trash soft-deletes: file moves into .trash, never disappears', () => {
    const { service, hub } = makeHubProject()
    service.write('prj_1', 'doomed', 'content survives')
    const snapshot = service.trash('prj_1', 'doomed')
    expect(snapshot.notes).toEqual([])
    expect(existsSync(join(hub, 'doomed.md'))).toBe(false)
    const trashed = readdirSync(join(hub, '.trash'))
    expect(trashed).toHaveLength(1)
    expect(readFileSync(join(hub, '.trash', trashed[0]), 'utf8')).toBe('content survives')
  })

  it('ignores foreign filenames in the hub instead of touching them', () => {
    const { service, hub } = makeHubProject()
    service.write('prj_1', 'real', 'ok')
    writeFileSync(join(hub, 'Weird Name!.md'), 'not-a-slug filename')
    writeFileSync(join(hub, 'notes.txt'), 'not markdown')
    mkdirSync(join(hub, '.trash'), { recursive: true })
    const snapshot = service.list('prj_1')
    expect(snapshot.notes.map((n) => n.name)).toEqual(['real'])
  })

  it('rejects oversized notes', () => {
    const { service } = makeHubProject()
    expect(() => service.write('prj_1', 'big', 'x'.repeat(500_001))).toThrow(/too large/i)
  })
})
