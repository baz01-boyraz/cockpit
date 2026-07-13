import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// SecretStore imports `safeStorage` from Electron, which is unavailable under a
// plain Node test runner. Mock it with a reversible, non-plaintext transform so
// we can prove both the round-trip AND that nothing is stored as cleartext.
vi.mock('electron', () => ({
  safeStorage: {
    isEncryptionAvailable: () => true,
    // base64 so the on-disk blob never contains the plaintext (real safeStorage
    // encrypts) while staying a reversible round-trip for the read-back tests.
    encryptString: (s: string) => Buffer.from(`enc::${Buffer.from(s, 'utf8').toString('base64')}`, 'utf8'),
    decryptString: (b: Buffer) =>
      Buffer.from(b.toString('utf8').replace(/^enc::/, ''), 'base64').toString('utf8'),
  },
}))

import { SecretStore } from '../electron/main/services/SecretStore'

describe('SecretStore', () => {
  const ref = 'openrouter.api-key'
  let baseDir: string

  beforeEach(() => {
    baseDir = mkdtempSync(join(tmpdir(), 'cockpit-secret-'))
  })

  afterEach(() => {
    rmSync(baseDir, { recursive: true, force: true })
  })

  it('reports encryption available when safeStorage is', () => {
    expect(new SecretStore(baseDir).available).toBe(true)
  })

  it('round-trips set → has → get', () => {
    const store = new SecretStore(baseDir)
    expect(store.has(ref)).toBe(false)
    expect(store.get(ref)).toBeNull()

    store.set(ref, 'sk-or-v1-secret-value')

    expect(store.has(ref)).toBe(true)
    expect(store.get(ref)).toBe('sk-or-v1-secret-value')
  })

  it('persists across store instances (same base dir)', () => {
    new SecretStore(baseDir).set(ref, 'persisted-key')
    expect(new SecretStore(baseDir).get(ref)).toBe('persisted-key')
  })

  it('never writes the secret as plaintext on disk', () => {
    const store = new SecretStore(baseDir)
    store.set(ref, 'sk-or-v1-should-be-encrypted')
    const secretsDir = join(baseDir, 'secrets')
    const files = readdirSync(secretsDir)
    expect(files.length).toBe(1)
    const raw = readFileSync(join(secretsDir, files[0]), 'utf8')
    expect(raw).not.toContain('sk-or-v1-should-be-encrypted')
  })

  it('delete removes the secret and is a no-op when absent', () => {
    const store = new SecretStore(baseDir)
    // No-op when nothing is stored.
    expect(() => store.delete(ref)).not.toThrow()

    store.set(ref, 'value')
    expect(store.has(ref)).toBe(true)

    store.delete(ref)
    expect(store.has(ref)).toBe(false)
    expect(store.get(ref)).toBeNull()
  })
})
