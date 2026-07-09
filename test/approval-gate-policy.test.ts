/**
 * D4 — the `guarded()` rule as executable policy (static analysis).
 *
 * CLAUDE.md security rule 4 mandates that a fixed set of destructive actions
 * (git_force_push, deploy, redeploy, restart_service, delete_file,
 * database_reset, env_write) never execute without passing the approval gate.
 * Today only `git_force_push` has a handler and it is correctly wrapped in
 * `guarded()` (registerIpc.ts). The standing risk is that a future
 * deploy / envWrite / railwayRestart-style handler lands WITHOUT the gate — a
 * silent hole the type system cannot see, since `guarded()` is a call
 * convention, not a type.
 *
 * This test text-scans `registerIpc.ts` (same approach as ipc-contract.test.ts)
 * and asserts: every handler whose channel name OR body mentions gated-action
 * vocabulary routes through `guarded(` or `ApprovalService.consume()`. It also
 * pins the shared risk policy (strong-approval set, always-require set) so the
 * classification behind the gate cannot silently weaken.
 *
 * The matcher itself is proven against inline fixtures — a compliant handler
 * must pass and a violation must be caught — so the scan can never go green by
 * failing to find anything.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { ApprovalActionType } from '@shared/domain'
import { needsStrongApproval, requiresApproval, riskLevelFor } from '@shared/approval-rules'

const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8')

// ---------------------------------------------------------------------------
// Handler parsing + gated-vocabulary matcher (pure — fixture-tested below).
// ---------------------------------------------------------------------------

interface HandlerReg {
  channel: string
  body: string
}

/**
 * Split a registerIpc-style source into its `handle('channel', …)`
 * registrations. Each handler's "body" is the text from its own `handle('`
 * marker up to the next one (or end of source) — a coarse but deterministic
 * slice that captures the handler's implementation and its leading comments.
 */
function parseHandlers(src: string): HandlerReg[] {
  const re = /\bhandle\('(\w+)'/g
  const marks: { channel: string; index: number }[] = []
  let m: RegExpExecArray | null
  while ((m = re.exec(src)) !== null) {
    marks.push({ channel: m[1], index: m.index })
  }
  return marks.map((mark, i) => ({
    channel: mark.channel,
    body: src.slice(mark.index, marks[i + 1]?.index ?? src.length),
  }))
}

/**
 * The gated-action vocabulary from CLAUDE.md, with obvious snake_case /
 * camelCase / hyphen variants. Matching is deliberately broad and fail-closed:
 * if a handler so much as mentions one of these concepts, it must carry the
 * gate (or be a documented exception).
 */
const GATED_VOCAB: readonly { label: string; re: RegExp }[] = [
  { label: 'deploy', re: /\bre?deploy/i }, // deploy + redeploy
  { label: 'restart', re: /\brestart/i },
  { label: 'force_push', re: /force[-_ ]?push|forcePush/i },
  {
    label: 'database_reset',
    re: /database[-_ ]?reset|databaseReset|\bdb[-_ ]?reset|dbReset/i,
  },
  { label: 'env_write', re: /env[-_ ]?write|envWrite|setEnv/i },
  { label: 'delete_file', re: /delete[-_ ]?file|deleteFile/i },
]

/**
 * Channels that match a gated keyword but operate on a NON-gated resource, and
 * so are legitimately ungated. Each entry needs a written justification — this
 * set is the one place a human consciously vouches that a keyword hit is safe,
 * and it is size-pinned below so it can never silently grow.
 */
const NON_GATED_EXCEPTIONS: ReadonlyMap<string, string> = new Map([
  [
    'terminalsRestart',
    'Restarts a local pseudo-terminal (node-pty) session, not a deployed ' +
      'service. CLAUDE.md gates restart_service (Railway), not terminal restart.',
  ],
])

/** A handler is gated if its body calls `guarded(` or `ApprovalService.consume`. */
function isGated(body: string): boolean {
  return /\bguarded\(/.test(body) || /\.consume\(/.test(body)
}

interface Violation {
  channel: string
  matched: string
}

/**
 * Every handler that mentions gated vocabulary but neither routes through the
 * gate nor is a documented non-gated exception. An empty result means the
 * policy holds.
 */
function findUngatedGatedHandlers(
  src: string,
  exceptions: ReadonlyMap<string, string> = NON_GATED_EXCEPTIONS,
): Violation[] {
  const violations: Violation[] = []
  for (const handler of parseHandlers(src)) {
    if (exceptions.has(handler.channel)) continue
    const hit = GATED_VOCAB.find((v) => v.re.test(handler.channel) || v.re.test(handler.body))
    if (!hit) continue
    if (isGated(handler.body)) continue
    violations.push({ channel: handler.channel, matched: hit.label })
  }
  return violations
}

const VIOLATION_HEADLINE = 'gated action registered without guarded() — see CLAUDE.md security rules'

function violationMessage(violations: Violation[]): string {
  const detail = violations.map((v) => `${v.channel} (matched: ${v.matched})`).join(', ')
  return `${VIOLATION_HEADLINE}: ${detail}`
}

// ---------------------------------------------------------------------------
// Policy enforcement against the real registerIpc.ts.
// ---------------------------------------------------------------------------

describe('approval gate policy — registerIpc.ts', () => {
  const mainSrc = read('electron/main/ipc/registerIpc.ts')
  const handlers = parseHandlers(mainSrc)

  it('parser found the handler surface (guards the scan itself)', () => {
    // A silently-empty parse would make every assertion below vacuously green.
    expect(handlers.length).toBeGreaterThan(40)
    expect(handlers.map((h) => h.channel)).toContain('gitPush')
  })

  it('no gated-vocabulary handler is registered without the gate', () => {
    const violations = findUngatedGatedHandlers(mainSrc)
    expect(violations, violationMessage(violations)).toEqual([])
  })

  it('git_force_push keeps its guarded() gate (regression pin)', () => {
    const gitPush = handlers.find((h) => h.channel === 'gitPush')
    expect(gitPush, 'gitPush handler must exist').toBeDefined()
    // The force-push leg must consume an approved request at the boundary.
    expect(gitPush!.body).toContain("guarded('git_force_push'")
    // …and our own matcher must classify it as gated, not skip it.
    expect(findUngatedGatedHandlers(mainSrc).some((v) => v.channel === 'gitPush')).toBe(false)
  })

  it('the non-gated exception set is minimal and each entry is justified', () => {
    // Pin the exception set so a new "safe" keyword handler can't be quietly
    // waved through by appending to it without review.
    expect([...NON_GATED_EXCEPTIONS.keys()]).toEqual(['terminalsRestart'])
    for (const [channel, why] of NON_GATED_EXCEPTIONS) {
      expect(why.length, `exception ${channel} needs a justification`).toBeGreaterThan(20)
      // The exception must correspond to a real, present handler.
      expect(handlers.map((h) => h.channel)).toContain(channel)
    }
  })
})

// ---------------------------------------------------------------------------
// Matcher self-proof — inline fixtures, never the real source. If the matcher
// were broken (matched nothing, or missed the gate check), these would fail.
// ---------------------------------------------------------------------------

describe('approval gate policy — matcher self-proof', () => {
  it('catches an ungated deploy/redeploy handler', () => {
    const fixture = `
      handle('railwayRedeploy', async (p) => {
        const input = redeploySchema.parse(p)
        return services.railway.redeploy(input)
      })
    `
    const violations = findUngatedGatedHandlers(fixture, new Map())
    expect(violations).toEqual([{ channel: 'railwayRedeploy', matched: 'deploy' }])
    expect(violationMessage(violations)).toContain(VIOLATION_HEADLINE)
    expect(violationMessage(violations)).toContain('railwayRedeploy')
  })

  it('catches ungated envWrite, restart, dbReset, deleteFile handlers', () => {
    const fixtures: [string, string][] = [
      ["handle('railwayEnvWrite', (p) => services.railway.setEnv(p))", 'env_write'],
      ["handle('railwayRestart', (p) => services.railway.restart(p))", 'restart'],
      ["handle('dbReset', (p) => services.db.reset(p))", 'database_reset'],
      ["handle('fsDeleteFile', (p) => services.files.delete(p))", 'delete_file'],
    ]
    for (const [src, label] of fixtures) {
      const violations = findUngatedGatedHandlers(src, new Map())
      expect(violations.length, `${label} fixture should be flagged`).toBe(1)
      expect(violations[0].matched).toBe(label)
    }
  })

  it('passes a gated handler wrapped in guarded()', () => {
    const fixture = `
      handle('railwayRedeploy', async (p) => {
        const input = redeploySchema.parse(p)
        return guarded('redeploy', input, () => services.railway.redeploy(input))
      })
    `
    expect(findUngatedGatedHandlers(fixture, new Map())).toEqual([])
  })

  it('passes a gated handler that consumes an approval directly', () => {
    const fixture = `
      handle('databaseReset', async (p) => {
        const input = dbResetSchema.parse(p)
        services.approvals.consume({ approvalId: input.approvalId, projectId: input.projectId, actionType: 'database_reset' })
        return services.db.reset(input)
      })
    `
    expect(findUngatedGatedHandlers(fixture, new Map())).toEqual([])
  })

  it('ignores non-gated handlers (no false positives)', () => {
    const fixture = `
      handle('projectsList', () => services.projects.list())
      handle('secretDelete', (p) => services.secrets.delete(SECRET_REFS[p.kind]))
      handle('gitStatus', (p) => services.git.status(p.projectId))
    `
    // secretDelete removes a keychain ref, not a file — 'delete' alone must not
    // trip the delete_file matcher.
    expect(findUngatedGatedHandlers(fixture, new Map())).toEqual([])
  })

  it('honors the exception map: a keyword handler is skipped only when excepted', () => {
    const fixture = "handle('terminalsRestart', (p) => services.terminals.restart(p.sessionId))"
    // Without the exception it is flagged…
    expect(findUngatedGatedHandlers(fixture, new Map())).toEqual([
      { channel: 'terminalsRestart', matched: 'restart' },
    ])
    // …and with the real exception map it is not.
    expect(findUngatedGatedHandlers(fixture)).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// Shared risk policy pins — the classification the gate leans on must not drift.
// ---------------------------------------------------------------------------

/** Parse the `ApprovalActionType` union from shared/domain.ts (text scan). */
function parseActionTypes(src: string): string[] {
  const start = src.indexOf('export type ApprovalActionType =')
  expect(start, 'ApprovalActionType union not found in shared/domain.ts').toBeGreaterThan(-1)
  const rest = src.slice(start)
  const end = rest.indexOf('export type RiskLevel')
  const block = rest.slice(0, end === -1 ? rest.length : end)
  return [...block.matchAll(/\|\s*'([a-z_]+)'/g)].map((m) => m[1])
}

describe('approval risk policy — shared/approval-rules.ts', () => {
  const actions = parseActionTypes(read('shared/domain.ts')) as ApprovalActionType[]

  it('found the full action-type union (guards the scan itself)', () => {
    expect(actions.length).toBeGreaterThanOrEqual(8)
    expect(actions).toContain('git_force_push')
    expect(actions).toContain('database_reset')
  })

  it('strong approval is required for exactly force-push and database_reset', () => {
    const strong = actions.filter((a) => needsStrongApproval(a)).sort()
    expect(strong).toEqual(['database_reset', 'git_force_push'])
  })

  it('force-push and database_reset are classified critical', () => {
    expect(riskLevelFor('git_force_push')).toBe('critical')
    expect(riskLevelFor('database_reset')).toBe('critical')
  })

  it('the always-require set can never be disabled by an empty allowlist', () => {
    // requiresApproval(action, []) is true only for the inherently-dangerous
    // actions — defense in depth against a misconfigured project allowlist.
    const alwaysRequired = actions.filter((a) => requiresApproval(a, [])).sort()
    expect(alwaysRequired).toEqual(['database_reset', 'deploy', 'git_force_push', 'redeploy'])
  })

  it('allowlisted actions still gate, and unlisted non-critical ones do not', () => {
    // env_write / restart_service / delete_file gate only when the project opts
    // in — pinned so the opt-in semantics stay intentional.
    expect(requiresApproval('env_write', [])).toBe(false)
    expect(requiresApproval('env_write', ['env_write'])).toBe(true)
    expect(requiresApproval('restart_service', [])).toBe(false)
    expect(requiresApproval('delete_file', [])).toBe(false)
    expect(requiresApproval('git_push', [])).toBe(false)
  })
})
