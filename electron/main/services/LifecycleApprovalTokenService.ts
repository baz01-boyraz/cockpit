import { createHash, randomBytes, randomUUID } from 'node:crypto'
import {
  chmodSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'

export type LifecycleApprovalAction = 'app_refresh' | 'app_install_release'

export interface LifecycleApprovalCapability {
  action: LifecycleApprovalAction
  token: string
  file: string
  expiresAt: string
}

interface ApprovalRecord {
  version: 1
  action: LifecycleApprovalAction
  projectId: string
  sourceDir: string
  tokenHash: string
  issuedAt: string
  expiresAt: string
}

interface LifecycleApprovalOptions {
  now?: () => Date
  ttlMs?: number
}

const DEFAULT_TTL_MS = 2 * 60_000
const MAX_TTL_MS = 5 * 60_000

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

/**
 * Mints a short-lived, single-use capability after Cockpit's own confirmation
 * dialog succeeds. The detached lifecycle script must consume the matching
 * private record before it can build, download, quit, replace, or relaunch.
 */
export class LifecycleApprovalTokenService {
  private readonly directory: string
  private readonly now: () => Date
  private readonly ttlMs: number

  constructor(userDataDir: string, options: LifecycleApprovalOptions = {}) {
    this.directory = join(userDataDir, 'lifecycle-approvals')
    this.now = options.now ?? (() => new Date())
    this.ttlMs = Math.min(Math.max(options.ttlMs ?? DEFAULT_TTL_MS, 1), MAX_TTL_MS)
  }

  issue(
    action: LifecycleApprovalAction,
    projectId: string,
    sourceDir: string,
  ): LifecycleApprovalCapability {
    mkdirSync(this.directory, { recursive: true, mode: 0o700 })
    chmodSync(this.directory, 0o700)
    this.removeExpiredRecords()

    const issuedAt = this.now()
    const expiresAt = new Date(issuedAt.getTime() + this.ttlMs)
    const token = randomBytes(32).toString('base64url')
    const file = join(this.directory, `approval-${randomUUID()}.json`)
    const record: ApprovalRecord = {
      version: 1,
      action,
      projectId,
      sourceDir: realpathSync(sourceDir),
      tokenHash: sha256(token),
      issuedAt: issuedAt.toISOString(),
      expiresAt: expiresAt.toISOString(),
    }
    writeFileSync(file, `${JSON.stringify(record)}\n`, {
      encoding: 'utf8',
      flag: 'wx',
      mode: 0o600,
    })
    return { action, token, file, expiresAt: record.expiresAt }
  }

  private removeExpiredRecords(): void {
    const now = this.now().getTime()
    for (const name of readdirSync(this.directory)) {
      if (!/^approval-[0-9a-f-]+\.json$/i.test(name)) continue
      const file = join(this.directory, name)
      try {
        const raw = JSON.parse(readFileSync(file, 'utf8')) as Partial<ApprovalRecord>
        const expiry = Date.parse(raw.expiresAt ?? '')
        if (!Number.isFinite(expiry) || expiry <= now) unlinkSync(file)
      } catch {
        // This directory is service-owned. Invalid leftovers are unusable and
        // should not accumulate indefinitely.
        try {
          unlinkSync(file)
        } catch {
          // A concurrent consumer may already have claimed it.
        }
      }
    }
  }
}
