import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { LifecycleApprovalTokenService } from '../electron/main/services/LifecycleApprovalTokenService'

const roots: string[] = []
const consumer = resolve('scripts/release/consume-lifecycle-approval.mjs')

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'cockpit-lifecycle-token-'))
  roots.push(root)
  return root
}

function consume(
  cwd: string,
  approval: { token: string; file: string },
  action: 'app_refresh' | 'app_install_release' = 'app_refresh',
) {
  return spawnSync(process.execPath, [consumer, action], {
    cwd,
    encoding: 'utf8',
    env: {
      ...process.env,
      COCKPIT_LIFECYCLE_APPROVAL_FILE: approval.file,
      COCKPIT_LIFECYCLE_APPROVAL_TOKEN: approval.token,
    },
  })
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('LifecycleApprovalTokenService', () => {
  it('issues a private token that the matching action consumes exactly once', () => {
    const root = tempRoot()
    const sourceDir = join(root, 'source')
    mkdirSync(sourceDir)
    const service = new LifecycleApprovalTokenService(join(root, 'user-data'))
    const approval = service.issue('app_refresh', 'project-1', sourceDir)

    expect(statSync(approval.file).mode & 0o077).toBe(0)
    expect(consume(sourceDir, approval).status).toBe(0)

    const replay = consume(sourceDir, approval)
    expect(replay.status).not.toBe(0)
    expect(replay.stderr).toMatch(/missing|already used|invalid/i)
  })

  it('rejects the wrong action and wrong checkout without exposing the token', () => {
    const root = tempRoot()
    const sourceDir = join(root, 'source')
    const otherDir = join(root, 'other')
    mkdirSync(sourceDir)
    mkdirSync(otherDir)
    const service = new LifecycleApprovalTokenService(join(root, 'user-data'))

    const wrongAction = service.issue('app_refresh', 'project-1', sourceDir)
    const actionResult = consume(sourceDir, wrongAction, 'app_install_release')
    expect(actionResult.status).not.toBe(0)
    expect(actionResult.stderr).not.toContain(wrongAction.token)

    const wrongPath = service.issue('app_refresh', 'project-1', sourceDir)
    const pathResult = consume(otherDir, wrongPath)
    expect(pathResult.status).not.toBe(0)
    expect(pathResult.stderr).not.toContain(wrongPath.token)
  })

  it('rejects expired tokens', () => {
    const root = tempRoot()
    const sourceDir = join(root, 'source')
    mkdirSync(sourceDir)
    const service = new LifecycleApprovalTokenService(join(root, 'user-data'), {
      now: () => new Date('2026-01-01T00:00:00.000Z'),
      ttlMs: 1_000,
    })
    const approval = service.issue('app_refresh', 'project-1', sourceDir)

    const result = consume(sourceDir, approval)
    expect(result.status).not.toBe(0)
    expect(result.stderr).toMatch(/expired/i)
  })
})
