import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { parseNote, noteLifecycle } from '@shared/memory-note-schema'

const roots: string[] = []
const script = resolve('scripts/memory/migrate-v2.mjs')

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'cockpit-memory-v2-'))
  roots.push(root)
  const hub = join(root, '.cockpit-memory')
  mkdirSync(hub)
  const legacy = (name: string, body: string) => [
    '---',
    'schema: 1',
    `name: ${name}`,
    `title: ${name}`,
    'class: reference',
    'gate: save',
    'updatedAt: 2026-07-01T00:00:00.000Z',
    '---',
    '',
    body,
    '',
  ].join('\n')
  writeFileSync(join(hub, 'hermes-old.md'), legacy('hermes-old', 'Historical orchestrator fact.'))
  writeFileSync(join(hub, 'model-routing-preference.md'), legacy('model-routing-preference', 'Retired provider routing preference.'))
  writeFileSync(join(hub, 'useful-note.md'), legacy('useful-note', 'Still relevant fact.'))
  return { hub, originalHermes: readFileSync(join(hub, 'hermes-old.md'), 'utf8') }
}

function run(hub: string, ...args: string[]) {
  return spawnSync(process.execPath, [script, '--root', hub, ...args], { encoding: 'utf8' })
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('Memory v2 one-time migration', () => {
  it('plans without writing, then snapshots and archives Hermes-era knowledge on apply', () => {
    const { hub, originalHermes } = fixture()
    const dry = run(hub)
    expect(dry.status).toBe(0)
    expect(dry.stdout).toMatch(/dry-run/i)
    expect(readFileSync(join(hub, 'hermes-old.md'), 'utf8')).toBe(originalHermes)
    expect(readdirSync(hub)).not.toContain('.snapshots')

    const applied = run(hub, '--apply')
    expect(applied.status).toBe(0)
    const snapshots = readdirSync(join(hub, '.snapshots'))
    expect(snapshots).toHaveLength(1)
    expect(readFileSync(join(hub, '.snapshots', snapshots[0], 'hermes-old.md'), 'utf8'))
      .toBe(originalHermes)

    const archived = parseNote(readFileSync(join(hub, 'hermes-old.md'), 'utf8'))
    expect(archived.frontmatter?.schema).toBe(2)
    expect(noteLifecycle(archived.frontmatter).status).toBe('archived')

    const active = parseNote(readFileSync(join(hub, 'useful-note.md'), 'utf8'))
    expect(noteLifecycle(active.frontmatter).status).toBe('active')
    expect(readFileSync(join(hub, 'runtime-architecture-no-hermes.md'), 'utf8'))
      .toMatch(/Hermes has been removed/i)
  })

  it('restores the exact pre-migration snapshot', () => {
    const { hub, originalHermes } = fixture()
    expect(run(hub, '--apply').status).toBe(0)
    const snapshot = readdirSync(join(hub, '.snapshots'))[0]
    expect(run(hub, '--restore', snapshot).status).toBe(0)
    expect(readFileSync(join(hub, 'hermes-old.md'), 'utf8')).toBe(originalHermes)
    expect(() => readFileSync(join(hub, 'runtime-architecture-no-hermes.md'), 'utf8')).toThrow()
  })

  it('migrates the global brain without injecting project architecture', () => {
    const { hub } = fixture()
    expect(run(hub, '--scope', 'global', '--apply').status).toBe(0)

    const retained = parseNote(readFileSync(join(hub, 'useful-note.md'), 'utf8'))
    expect(retained.frontmatter?.scope).toBe('global')
    const retired = parseNote(readFileSync(join(hub, 'model-routing-preference.md'), 'utf8'))
    expect(noteLifecycle(retired.frontmatter).status).toBe('archived')
    expect(readFileSync(join(hub, 'owner-direct-agent-constitution.md'), 'utf8'))
      .toMatch(/Swarm is opt-in/i)
    expect(() => readFileSync(join(hub, 'runtime-architecture-no-hermes.md'), 'utf8')).toThrow()
  })
})
