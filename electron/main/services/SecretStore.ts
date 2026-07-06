import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { safeStorage } from 'electron'

/**
 * OS-backed secret storage. Secrets (Railway/GitHub tokens) are encrypted with
 * Electron's safeStorage (Keychain on macOS) and written to disk as opaque
 * blobs. The renderer only ever sees a `tokenRef` string — never the value.
 *
 * Design rule: nothing in here is exposed over IPC that returns a decrypted
 * value. `get` is main-process only and used by service adapters.
 */
export class SecretStore {
  private readonly dir: string

  constructor(baseDir: string) {
    this.dir = join(baseDir, 'secrets')
    if (!existsSync(this.dir)) mkdirSync(this.dir, { recursive: true })
  }

  private fileFor(ref: string): string {
    const safe = ref.replace(/[^a-zA-Z0-9._-]/g, '_')
    return join(this.dir, `${safe}.bin`)
  }

  get available(): boolean {
    try {
      return safeStorage.isEncryptionAvailable()
    } catch {
      return false
    }
  }

  set(ref: string, value: string): void {
    if (!this.available) {
      throw new Error('Secret encryption is not available on this platform.')
    }
    const encrypted = safeStorage.encryptString(value)
    writeFileSync(this.fileFor(ref), encrypted)
  }

  has(ref: string): boolean {
    return existsSync(this.fileFor(ref))
  }

  /** Remove a stored secret. No-op if it was never set. */
  delete(ref: string): void {
    const file = this.fileFor(ref)
    if (existsSync(file)) rmSync(file)
  }

  /** Main-process only. Never wire this to an IPC response. */
  get(ref: string): string | null {
    const file = this.fileFor(ref)
    if (!existsSync(file)) return null
    try {
      return safeStorage.decryptString(readFileSync(file))
    } catch {
      return null
    }
  }
}
