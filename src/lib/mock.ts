/**
 * In-browser mock implementation of CockpitApi.
 *
 * When the app runs inside Electron, `window.cockpit` (the preload bridge) is
 * present and used. When the renderer is served as a plain web page — e.g. for
 * the localhost screenshot review workflow, or graceful degradation — this mock
 * stands in with realistic seed data so every panel is meaningful. It reuses the
 * same shared router/log-pattern logic the real backend uses.
 */
import type {
  ApprovalRequest,
  DashboardSnapshot,
  ErrorInsight,
  AppUpdateState,
  GitCommitResult,
  GitHubRepositoryStatus,
  GitSnapshot,
  Project,
  ProjectConfig,
  RailwayConnection,
  RailwayService,
  TerminalOutputChunk,
  TerminalSession,
} from '@shared/domain'
import type { CockpitApi, SystemInfo, Unsubscribe } from '@shared/ipc'
import type { CouncilResult, ScorecardEntry } from '@shared/council'
import { buildSignal, type SentinelSignal } from '@shared/sentinel'
import { resolveChatModel } from '@shared/chat-models'
import { assembleDashboard, countActiveAgents } from '@shared/dashboard-assembly'
import { aggregateInsights, insightFromMatch } from '@shared/insight-aggregation'
import { assembleHubSnapshot, assembleNote, type MemoryDoc } from '@shared/memory-hub'
import { assembleHealth } from '@shared/memory-health'
import { analyzeConsolidation } from '@shared/memory-consolidate'
import type { CaptureResult } from '@shared/memory-pipeline'
import type { ReviewItem } from '@shared/memory-review'

/** Browser-only review queue so the memory review UI has something to render. */
const mockReviews = new Map<string, ReviewItem[]>()
const reviewsFor = (projectId: string): ReviewItem[] => mockReviews.get(projectId) ?? []
import {
  appendPosition,
  assembleBoard,
  cardBranch,
  moveCardInList,
  type KanbanCard,
} from '@shared/kanban'
import { extractAcceptanceCriteria } from '@shared/completion-report'
import { normalizeNoteName, renameLinkTargets } from '@shared/wikilink'
import { classifyRoute } from '@shared/router'
import { classifyRoles } from '@shared/role-router'
import type { Assignment } from '@shared/agent-taxonomy'
import { matchLogLine } from '@shared/log-patterns'
import {
  BANNER,
  MOCK_PROMPT,
  MOCK_SESSION,
  agentUsageReport,
  approvals,
  audit,
  claudeSessionsMock,
  gitSeeds,
  githubByProject,
  id,
  insightEvents,
  logs,
  kanbanSeed,
  memoryHub,
  namedAgentsMock,
  now,
  openRouterUsageSnapshot,
  projects,
  usage,
} from './mockData'

const gitState = new Map<string, GitSnapshot>()
const githubState = new Map<string, GitHubRepositoryStatus>()
/** Browser-preview secret store (in-memory; values are never read back). */
const mockSecrets = new Map<string, string>()
/** Browser-preview Hermes chat turn counter, per project (reset on clear). */
const mockHermesChats = new Map<string, number>()

/** Browser-preview sentinel feed, seeded lazily per project so the signal layer
 *  (Faz A) renders one alert + one notice without a backend. */
const mockSentinel = new Map<string, SentinelSignal[]>()
function sentinelFor(projectId: string): SentinelSignal[] {
  const existing = mockSentinel.get(projectId)
  if (existing) return existing
  const seeded: SentinelSignal[] = [
    buildSignal({
      id: `sig_${projectId}_approval`,
      projectId,
      severity: 'alert',
      source: 'approval',
      title: 'Approval needed: Force-push rewrites main',
      summary: 'A git_force_push action is waiting for your decision.',
      context: 'action=git_force_push · risk=high',
      createdAt: now(),
    }),
    buildSignal({
      id: `sig_${projectId}_log`,
      projectId,
      severity: 'notice',
      source: 'log-intelligence',
      title: 'Cannot find module "@shared/schemas"',
      summary: 'A stale build likely dropped the alias · run the build step, then retry.',
      context: "Error: Cannot find module '@shared/schemas'",
      createdAt: now(),
    }),
  ]
  mockSentinel.set(projectId, seeded)
  return seeded
}

function gitSnapshotFor(projectId: string): GitSnapshot {
  const current = gitState.get(projectId)
  if (current) return current
  const seed = gitSeeds[projectId] ?? gitSeeds.prj_cockpit
  const fresh: GitSnapshot = { ...seed, files: seed.files.map((f) => ({ ...f })) }
  gitState.set(projectId, fresh)
  return fresh
}

function githubStatusFor(projectId: string): GitHubRepositoryStatus {
  return githubState.get(projectId) ?? githubByProject[projectId] ?? githubByProject.prj_cockpit
}

let appUpdateState: AppUpdateState = {
  phase: 'available',
  currentVersion: '0.1.0',
  latestVersion: '0.1.1',
  releaseName: 'Private beta refresh',
  releaseNotes: 'GitHub-connected source control and in-app update controls.',
  progressPercent: null,
  canCheck: true,
  canDownload: true,
  canInstall: false,
  error: null,
  checkedAt: now(),
}

const insightDismissals = new Map<string, Map<string, string>>()

function dismissalsFor(projectId: string): Map<string, string> {
  const existing = insightDismissals.get(projectId)
  if (existing) return existing
  const fresh = new Map<string, string>()
  insightDismissals.set(projectId, fresh)
  return fresh
}

/** Same aggregation rule the real LogIntelligenceService delegates to. */
function listInsightsMock(projectId: string): ErrorInsight[] {
  const events = insightEvents.filter((e) => e.projectId === projectId)
  return aggregateInsights(events, dismissalsFor(projectId))
}

const terminals: Record<string, TerminalSession[]> = { prj_serbest: [], prj_cockpit: [] }

const dataListeners = new Set<(c: TerminalOutputChunk) => void>()
const approvalListeners = new Set<() => void>()
const appUpdateListeners = new Set<(s: AppUpdateState) => void>()
const logsListeners = new Set<() => void>()
const notifyLogsChanged = () => logsListeners.forEach((cb) => cb())

const memoryDocsFor = (projectId: string): MemoryDoc[] => memoryHub.get(projectId) ?? []
const kanbanFor = (projectId: string): KanbanCard[] => kanbanSeed.get(projectId) ?? []

function emit(sessionId: string, data: string) {
  for (const cb of dataListeners) cb({ sessionId, data, at: now() })
}

function osc133(seq: string): string {
  return `\x1b]133;${seq}\x07`
}

function emitPrompt(sessionId: string) {
  emit(sessionId, osc133('A') + MOCK_PROMPT + osc133('B'))
}

function emitBlock(sessionId: string, command: string, lines: string[], exitCode: number | null) {
  emit(sessionId, `${command}\r\n`)
  emit(sessionId, osc133('C'))
  for (const line of lines) emit(sessionId, `${line}\r\n`)
  if (exitCode !== null) emit(sessionId, osc133(`D;${exitCode}`))
}

function runMockSession(sessionId: string) {
  for (const line of BANNER) emit(sessionId, `${line}\r\n`)
  let at = 120
  for (const step of MOCK_SESSION) {
    const start = at
    setTimeout(() => {
      emitPrompt(sessionId)
      emit(sessionId, `${step.command}\r\n`)
      emit(sessionId, osc133('C'))
    }, start)
    setTimeout(() => {
      for (const line of step.lines) emit(sessionId, `${line}\r\n`)
      if (step.exitCode !== null) emit(sessionId, osc133(`D;${step.exitCode}`))
    }, start + step.runMs)
    at = start + step.runMs + 340
  }
}

function configFor(p: Project): ProjectConfig {
  return {
    version: 1,
    project: { name: p.name, path: p.path, techStack: p.techStack },
    terminals: {
      max: 6,
      layout: [],
      profiles: [
        { name: 'Dev server', cwd: '.', command: 'npm run dev', role: 'frontend' },
        { name: 'Claude Code', cwd: '.', command: 'claude', role: 'claude' },
        { name: 'Codex', cwd: '.', command: 'codex', role: 'codex' },
      ],
    },
    railway: { projectId: null, environmentId: null, services: ['web', 'api', 'postgres'] },
    safety: {
      requireApprovalFor: ['git_push', 'git_force_push', 'deploy', 'redeploy', 'restart_service', 'delete_file', 'database_reset', 'env_write'],
    },
  }
}

// Same shape-building as the real Services.dashboard() (shared/dashboard-assembly).
function dashboardFor(projectId: string): DashboardSnapshot {
  const terms = terminals[projectId] ?? []
  return assembleDashboard({
    project: projects.find((p) => p.id === projectId) ?? projects[0],
    git: gitState.get(projectId) ?? gitSeeds[projectId] ?? null,
    terminals: terms,
    agentCount: countActiveAgents(terms),
    railwayConnected: false,
    railwayServiceCount: 3,
    recentErrors: listInsightsMock(projectId),
    pendingApprovals: approvals.filter((a) => a.projectId === projectId && a.status === 'pending').length,
    usage: projectId === 'prj_serbest' ? usage : [],
  })
}

// A finished diff-mode council session for the browser preview. The engine mix
// (opus / deepseek via openrouter / haiku / sonnet / codex) mirrors the real
// roster so the seat chips render exactly as production does.
function mockDiffCouncil(): CouncilResult {
  const seats: CouncilResult['seats'] = [
    {
      id: 'contrarian',
      label: 'Contrarian',
      engine: { engine: 'claude', model: 'opus' },
      usedFallback: false,
      ok: true,
      text: 'The intake handler in Hero.tsx:42 posts formData with no schema guard — a crafted payload reaches the API unchecked. Under a project switch the useEffect fetch at Hero.tsx:58 also races and can apply stale results.',
    },
    {
      id: 'first-principles',
      label: 'First Principles',
      engine: { engine: 'openrouter', model: 'deepseek/deepseek-chat' },
      usedFallback: false,
      ok: true,
      text: 'The real problem is trust at the boundary, not the form UI. schemas.ts already exports the shape both sides import — validation belongs there, not inline in the view at Hero.tsx:44.',
    },
    {
      id: 'expansionist',
      label: 'Expansionist',
      engine: { engine: 'claude', model: 'haiku' },
      usedFallback: false,
      ok: true,
      text: 'If the submit path at Hero.tsx:42 validated through the shared zod schema, every other form inherits it for free. The bigger play is a single validated-submit hook.',
    },
    {
      id: 'outsider',
      label: 'Outsider',
      engine: { engine: 'claude', model: 'sonnet' },
      usedFallback: false,
      ok: true,
      text: 'A newcomer would not guess that `--accent-2` is defined twice in tokens.css:31 and tokens.css:77 and the second silently wins. That invisible override is exactly what trips people up later.',
    },
    {
      id: 'builder',
      label: 'Builder',
      engine: { engine: 'claude', model: 'opus' },
      usedFallback: true,
      ok: true,
      text: 'Buildable after one change. FEASIBILITY: buildable-with-risks — the fix is local but touches a shared schema. EFFORT: S — ~30 min. PLAN: shared/schemas.ts (add submit schema), src/components/Hero.tsx (validate + abort guard). AMBIGUITIES: 1. which fields are required on submit is not stated.',
    },
  ]
  const labelToSeat: Record<string, CouncilResult['labelToSeat'][string]> = {
    'Response A': 'first-principles',
    'Response B': 'builder',
    'Response C': 'contrarian',
    'Response D': 'expansionist',
    'Response E': 'outsider',
  }
  const rankings: CouncilResult['rankings'] = [
    {
      seatId: 'contrarian',
      text: 'Response A reframes the fix best; Response E is cosmetic. COLLECTIVE GAP: none proposed a regression test.\n\nFINAL RANKING:\n1. Response A\n2. Response B\n3. Response C\n4. Response D\n5. Response E',
      parsed: ['Response A', 'Response B', 'Response C', 'Response D', 'Response E'],
    },
    {
      seatId: 'builder',
      text: 'Response A is the highest-leverage. COLLECTIVE GAP: no one named the missing test.\n\nFINAL RANKING:\n1. Response A\n2. Response C\n3. Response B\n4. Response D\n5. Response E',
      parsed: ['Response A', 'Response C', 'Response B', 'Response D', 'Response E'],
    },
  ]
  return {
    ok: true,
    mode: 'diff',
    seats,
    rankings,
    aggregate: [
      { seatId: 'first-principles', averageRank: 1, count: 2 },
      { seatId: 'contrarian', averageRank: 2.5, count: 2 },
      { seatId: 'builder', averageRank: 2.5, count: 2 },
      { seatId: 'expansionist', averageRank: 4, count: 2 },
      { seatId: 'outsider', averageRank: 5, count: 2 },
    ],
    labelToSeat,
    verdict: `### ⚖️ Consensus & Disagreement\nAll five agree the unvalidated submit is the real risk; they split on scope — fix-it-here vs. fix-it-in-the-schema-layer.\n\n### 🎯 Verdict\nShip it, but not as written. Move validation into the shared schema at the submit boundary and add the mounted/abort guard — this closes the security hole and the race in one pass.\n\n### ➡️ Next step\nAdd a failing test that posts an invalid payload, then make it pass by validating through the shared zod schema before the API call.`,
    specVerdict: null,
    error: null,
    stats: { seatsRun: 5, seatsFailed: 0, filesReviewed: 4, durationMs: 1600 },
    sessionId: 'mock-council-diff',
  }
}

// A finished spec-mode gate for the browser preview: a NEEDS_CLARIFICATION
// verdict with the questions the author must answer before a build starts.
function mockSpecCouncil(): CouncilResult {
  const seats: CouncilResult['seats'] = [
    {
      id: 'contrarian',
      label: 'Contrarian',
      engine: { engine: 'claude', model: 'opus' },
      usedFallback: false,
      ok: true,
      text: 'The spec says "add caching" but never states what to cache or the invalidation rule — that sentence hides the hardest decision. Without it the builder will guess and ship the wrong TTL.',
    },
    {
      id: 'first-principles',
      label: 'First Principles',
      engine: { engine: 'openrouter', model: 'deepseek/deepseek-chat' },
      usedFallback: true,
      ok: true,
      text: 'The acceptance criterion "should be fast" is untestable as written. Fast against what baseline, measured how? The real requirement is a concrete latency budget.',
    },
    {
      id: 'expansionist',
      label: 'Expansionist',
      engine: { engine: 'claude', model: 'haiku' },
      usedFallback: false,
      ok: true,
      text: 'If the cache key were derived from the existing request schema, the same layer could memoize three other endpoints for free — the spec scopes this too narrowly.',
    },
    {
      id: 'outsider',
      label: 'Outsider',
      engine: { engine: 'claude', model: 'sonnet' },
      usedFallback: false,
      ok: true,
      text: 'The spec assumes I know where "the gateway" is. A newcomer cannot find it from this text — name the module.',
    },
    {
      id: 'builder',
      label: 'Builder',
      engine: { engine: 'codex', model: '' },
      usedFallback: false,
      ok: true,
      text: 'FEASIBILITY: not-yet — two blockers. EFFORT: M once resolved. PLAN: the gateway service + a cache util. AMBIGUITIES: 1. what to cache; 2. invalidation rule; 3. the latency target.',
    },
  ]
  return {
    ok: true,
    mode: 'spec',
    seats,
    rankings: [
      {
        seatId: 'builder',
        text: 'Response A found the untestable criterion. COLLECTIVE GAP: no one asked about cache size limits.\n\nFINAL RANKING:\n1. Response A\n2. Response B\n3. Response C\n4. Response D\n5. Response E',
        parsed: ['Response A', 'Response B', 'Response C', 'Response D', 'Response E'],
      },
    ],
    aggregate: [
      { seatId: 'first-principles', averageRank: 1, count: 1 },
      { seatId: 'contrarian', averageRank: 2, count: 1 },
    ],
    labelToSeat: {
      'Response A': 'first-principles',
      'Response B': 'contrarian',
      'Response C': 'builder',
      'Response D': 'expansionist',
      'Response E': 'outsider',
    },
    verdict: `### ⚖️ Consensus & Disagreement\nEvery seat agrees the spec is directionally right but under-specified; they split on whether the caching scope should widen.\n\n### 🎯 Verdict\nNEEDS_CLARIFICATION\nThe goal is clear but two acceptance criteria are untestable and the target module is unnamed — a builder would guess.\n\n### 📋 Refined Spec\n**Goal** — Cache the gateway's read responses to cut repeat latency.\n**Context** — Applies to the request/response layer both sides already share.\n**Acceptance criteria** — 1. p95 latency for a cached read drops below the agreed budget. 2. A write invalidates the matching cache key. 3. Cache size is bounded.\n**Out of scope** — Write-path batching, cross-service cache.\n**Constraints** — No new external dependency; keys derived from the existing schema.\n\n### ❓ Questions for the author\n1. What exactly should be cached, and what is the invalidation rule?\n2. What is the concrete latency target the cache must hit?\n3. Which module is "the gateway"?`,
    specVerdict: {
      kind: 'needs_clarification',
      questions: [
        'What exactly should be cached, and what is the invalidation rule?',
        'What is the concrete latency target the cache must hit?',
        'Which module is "the gateway"?',
      ],
    },
    error: null,
    stats: { seatsRun: 5, seatsFailed: 0, filesReviewed: 0, durationMs: 1600 },
    sessionId: 'mock-council-spec',
  }
}

// A finished spec-mode gate that APPROVES: the council finds the draft
// buildable and returns a refined spec the editor can paste into the body.
// Reached in the browser preview when the draft mentions "acceptance", so both
// gate branches (approve / clarify) are visually reviewable without a backend.
function mockSpecCouncilApproved(): CouncilResult {
  const base = mockSpecCouncil()
  return {
    ...base,
    seats: base.seats.map((s) =>
      s.id === 'builder'
        ? { ...s, text: 'FEASIBILITY: buildable. EFFORT: M. PLAN: the gateway service + a cache util. The acceptance criteria are concrete and the target module is named — no blocking guesses remain.' }
        : s,
    ),
    verdict: `### ⚖️ Consensus & Disagreement\nEvery seat agrees the spec is now concrete: a named module, a measurable latency budget, and a clear invalidation rule.\n\n### 🎯 Verdict\nAPPROVED\nThe goal, acceptance criteria, and scope are all testable — a builder can start without guessing.\n\n### 📋 Refined Spec\n**Goal** — Cache the gateway service's read responses to cut repeat-read latency.\n**Context** — Applies to the shared request/response layer both sides already import.\n**Acceptance criteria** — 1. p95 latency for a cached read drops below 40ms. 2. A write to a key invalidates its cached entry within one request. 3. The cache is bounded to 500 entries (LRU).\n**Out of scope** — Write-path batching, cross-service cache sharing.\n**Constraints** — No new external dependency; keys derived from the existing request schema.\n\n### ❓ Questions for the author\n(None — the spec is buildable as written.)`,
    specVerdict: { kind: 'approved', questions: [] },
    sessionId: 'mock-council-spec-approved',
  }
}

export function createMockApi(): CockpitApi {
  return {
    projects: {
      list: async () => projects,
      add: async (input) => {
        const p: Project = {
          id: id('prj'),
          name: input.name ?? input.path.split('/').pop() ?? 'New Project',
          path: input.path,
          techStack: [],
          createdAt: now(),
          updatedAt: now(),
          lastOpenedAt: now(),
        }
        projects.unshift(p)
        terminals[p.id] = []
        return p
      },
      select: async (projectId) => dashboardFor(projectId),
      config: async (projectId) => configFor(projects.find((p) => p.id === projectId) ?? projects[0]),
      dashboard: async (projectId) => dashboardFor(projectId),
    },
    terminals: {
      list: async (projectId) => terminals[projectId] ?? [],
      create: async (input) => {
        const list = terminals[input.projectId] ?? (terminals[input.projectId] = [])
        const session: TerminalSession = {
          id: id('term'),
          projectId: input.projectId,
          name: input.name ?? `Terminal ${list.length + 1}`,
          role: input.role ?? null,
          alias: null,
          cwd: '.',
          shell: '/bin/zsh',
          status: 'running',
          pid: Math.floor(Math.random() * 90000) + 1000,
          exitCode: null,
          createdAt: now(),
          lastActiveAt: now(),
        }
        list.push(session)
        setTimeout(() => runMockSession(session.id), 120)
        return session
      },
      write: async (sessionId, data) => {
        if (data.includes('\r')) {
          emit(sessionId, '\r\n')
          emitBlock(sessionId, '', ['\x1b[2m(mock shell — command echoed in browser preview)\x1b[0m'], 0)
          emitPrompt(sessionId)
        } else {
          emit(sessionId, data)
        }
      },
      resize: async () => {},
      kill: async (sessionId) => {
        for (const list of Object.values(terminals)) {
          const t = list.find((s) => s.id === sessionId)
          if (t) t.status = 'killed'
        }
      },
      restart: async (sessionId) => {
        let found: TerminalSession | undefined
        for (const list of Object.values(terminals)) found = list.find((s) => s.id === sessionId) ?? found
        if (found) found.status = 'running'
        return found as TerminalSession
      },
      rename: async (sessionId, name, role, alias) => {
        let found: TerminalSession | undefined
        for (const list of Object.values(terminals)) found = list.find((s) => s.id === sessionId) ?? found
        if (found) {
          found.name = name
          if (role !== undefined) found.role = role
          if (alias !== undefined) found.alias = alias
        }
        return found as TerminalSession
      },
      launchAgent: async (projectId, agent) => {
        const list = terminals[projectId] ?? (terminals[projectId] = [])
        const session: TerminalSession = {
          id: id('term'),
          projectId,
          name: agent === 'claude' ? 'Claude Code' : 'Codex',
          role: agent,
          alias: null,
          cwd: '.',
          shell: '/bin/zsh',
          status: 'running',
          pid: Math.floor(Math.random() * 90000) + 1000,
          exitCode: null,
          createdAt: now(),
          lastActiveAt: now(),
        }
        list.push(session)
        setTimeout(() => emit(session.id, `\x1b[38;5;208m●\x1b[0m launching \x1b[1m${agent}\x1b[0m…\r\n`), 140)
        return session
      },
      claudeSessions: async () => claudeSessionsMock,
      resumeClaude: async (projectId, sessionId) => {
        const list = terminals[projectId] ?? (terminals[projectId] = [])
        const session: TerminalSession = {
          id: id('term'),
          projectId,
          name: 'Claude Code',
          role: 'claude',
          alias: null,
          cwd: '.',
          shell: '/bin/zsh',
          status: 'running',
          pid: Math.floor(Math.random() * 90000) + 1000,
          exitCode: null,
          createdAt: now(),
          lastActiveAt: now(),
        }
        list.push(session)
        setTimeout(() => emit(session.id, `\x1b[38;5;208m●\x1b[0m resuming \x1b[1mclaude\x1b[0m session \x1b[2m${sessionId.slice(0, 8)}\x1b[0m…\r\n`), 140)
        return session
      },
      attachImage: async (input) => {
        const safe = input.fileName.replace(/[^a-zA-Z0-9._-]+/g, '-')
        const attachmentId = id('att')
        const name = `${attachmentId}-${safe || 'screenshot.png'}`
        return {
          id: attachmentId,
          projectId: input.projectId,
          sessionId: input.sessionId ?? null,
          name,
          path: `/Users/baz/Projects/mock/.dev-cockpit/attachments/${name}`,
          relativePath: `.dev-cockpit/attachments/${name}`,
          mimeType: input.mimeType,
          size: Math.floor((input.dataBase64.length * 3) / 4),
          createdAt: now(),
        }
      },
      onData: (cb) => {
        dataListeners.add(cb)
        return (() => dataListeners.delete(cb)) as Unsubscribe
      },
      onExit: () => (() => {}) as Unsubscribe,
    },
    git: {
      status: async (projectId) => gitSnapshotFor(projectId),
      initRepo: async (projectId) => {
        const prev = gitSnapshotFor(projectId)
        if (prev.branch !== 'no-git') return prev
        const next: GitSnapshot = { ...prev, branch: 'main' }
        gitState.set(projectId, next)
        return next
      },
      diff: async ({ path }) => ({
        path,
        binary: false,
        hunks: `diff --git a/${path} b/${path}\n@@ -12,7 +12,9 @@\n-  <h1 className="text-3xl">Serbest Law</h1>\n+  <h1 className="text-5xl tracking-tight font-semibold">\n+    Serbest Law\n+  </h1>\n   <p className="text-stone-400">Trusted counsel for modern business.</p>`,
      }),
      stage: async ({ projectId }) => {
        const prev = gitSnapshotFor(projectId)
        const files = prev.files.map((file) =>
          file.state === 'staged'
            ? file
            : { ...file, state: 'staged' as const, index: file.workingDir.trim() || 'A', workingDir: ' ' },
        )
        const next: GitSnapshot = { ...prev, files, stagedCount: files.length, unstagedCount: 0, untrackedCount: 0 }
        gitState.set(projectId, next)
        return next
      },
      commit: async ({ projectId, message }): Promise<GitCommitResult> => {
        const prev = gitSnapshotFor(projectId)
        const next: GitSnapshot = {
          ...prev,
          ahead: prev.ahead + 1,
          changedFilesCount: 0,
          stagedCount: 0,
          unstagedCount: 0,
          untrackedCount: 0,
          files: [],
        }
        gitState.set(projectId, next)
        return { branch: prev.branch, commitHash: 'mock1234', summary: message, filesChanged: prev.stagedCount }
      },
      push: async ({ projectId, force, approvalId }) => {
        // Mirror the real boundary: force-push without an approved request id
        // is refused in main, so the mock refuses it too.
        if (force && !approvalId) {
          throw new Error('Force-push requires an approved request — request approval first.')
        }
        const prev = gitSnapshotFor(projectId)
        gitState.set(projectId, { ...prev, ahead: 0 })
        return {
          branch: prev.branch,
          remote: 'origin',
          forced: Boolean(force),
          ahead: 0,
          behind: prev.behind,
          pushedAt: now(),
        }
      },
    },
    github: {
      status: async (projectId) => githubStatusFor(projectId),
      createRepo: async (input) => {
        const prev = gitSnapshotFor(input.projectId)
        if (prev.branch === 'no-git') {
          gitState.set(input.projectId, { ...prev, branch: 'main' })
        }
        const login = 'baz01-boyraz'
        const next: GitHubRepositoryStatus = {
          connected: true,
          authState: 'authenticated',
          account: { login, name: 'Baz', avatarUrl: null, htmlUrl: `https://github.com/${login}` },
          remote: {
            name: 'origin',
            url: `git@github.com:${login}/${input.name}.git`,
            provider: 'github',
            owner: login,
            repo: input.name,
            webUrl: `https://github.com/${login}/${input.name}`,
          },
          repository: {
            owner: login,
            name: input.name,
            fullName: `${login}/${input.name}`,
            private: input.visibility === 'private',
            defaultBranch: 'main',
            htmlUrl: `https://github.com/${login}/${input.name}`,
            description: input.description ?? null,
          },
          openPullRequest: null,
          latestWorkflowRun: null,
          latestRelease: null,
          error: null,
          fetchedAt: now(),
        }
        githubState.set(input.projectId, next)
        return next
      },
    },
    railway: {
      status: async (projectId): Promise<RailwayConnection> => ({
        id: 'unconnected',
        projectId,
        railwayProjectId: null,
        railwayEnvironmentId: null,
        tokenRef: null,
        connected: false,
        createdAt: now(),
        updatedAt: now(),
      }),
      services: async (): Promise<RailwayService[]> => [
        { id: id('rsvc'), connectionId: 'local', railwayServiceId: 'web', name: 'web', serviceType: 'frontend', status: 'unknown', url: null, startCommand: 'npm run start', updatedAt: now() },
        { id: id('rsvc'), connectionId: 'local', railwayServiceId: 'api', name: 'api', serviceType: 'backend', status: 'unknown', url: null, startCommand: 'uvicorn main:app', updatedAt: now() },
        { id: id('rsvc'), connectionId: 'local', railwayServiceId: 'postgres', name: 'postgres', serviceType: 'database', status: 'unknown', url: null, startCommand: null, updatedAt: now() },
      ],
      env: async () => [
        { key: 'DATABASE_URL', maskedValue: 'po••••••••••', masked: true },
        { key: 'NODE_ENV', maskedValue: 'production', masked: false },
        { key: 'RAILWAY_TOKEN', maskedValue: '••••••••', masked: true },
        { key: 'NEXT_PUBLIC_API_URL', maskedValue: 'https://api.serbest.law', masked: false },
      ],
    },
    logs: {
      list: async (projectId) => logs.filter((l) => l.projectId === projectId),
      insights: async (projectId) => listInsightsMock(projectId),
      ingest: async ({ projectId, message }) => {
        const m = matchLogLine(message)
        if (!m) return null
        const insight = insightFromMatch(m, { id: id('ins'), projectId, createdAt: now() })
        insightEvents.unshift(insight)
        notifyLogsChanged()
        return insight
      },
      dismissInsight: async (projectId, matchedPattern) => {
        const upTo = insightEvents
          .filter((e) => e.projectId === projectId && e.matchedPattern === matchedPattern)
          .reduce((max, e) => (e.createdAt > max ? e.createdAt : max), '')
        dismissalsFor(projectId).set(matchedPattern, upTo || now())
        notifyLogsChanged()
      },
      clearInsights: async (projectId) => {
        const dismissals = dismissalsFor(projectId)
        for (const insight of listInsightsMock(projectId)) {
          dismissals.set(insight.matchedPattern, insight.lastSeenAt)
        }
        notifyLogsChanged()
      },
      onChange: (cb) => {
        logsListeners.add(cb)
        return (() => logsListeners.delete(cb)) as Unsubscribe
      },
    },
    usage: { summary: async (projectId) => (projectId === 'prj_serbest' ? usage : []) },
    agentUsage: { get: async () => agentUsageReport() },
    openRouterUsage: { status: async () => openRouterUsageSnapshot() },
    approvals: {
      list: async (projectId) => approvals.filter((a) => a.projectId === projectId),
      request: async (input) => {
        const req: ApprovalRequest = {
          id: id('apr'),
          projectId: input.projectId,
          actionType: input.actionType,
          riskLevel: 'high',
          summary: input.summary,
          payload: input.payload ?? {},
          status: 'pending',
          createdAt: now(),
          resolvedAt: null,
        }
        approvals.unshift(req)
        approvalListeners.forEach((cb) => cb())
        return req
      },
      decide: async (approvalId, approve) => {
        const a = approvals.find((x) => x.id === approvalId)!
        a.status = approve ? 'approved' : 'rejected'
        a.resolvedAt = now()
        approvalListeners.forEach((cb) => cb())
        return a
      },
      onChange: (cb) => {
        approvalListeners.add(cb)
        return (() => approvalListeners.delete(cb)) as Unsubscribe
      },
    },
    router: { route: async (_projectId, query) => classifyRoute(query) },
    memory: {
      list: async (projectId) => assembleHubSnapshot(memoryDocsFor(projectId)),
      read: async (projectId, name) => assembleNote(memoryDocsFor(projectId), name),
      write: async (projectId, name, content) => {
        const slug = normalizeNoteName(name)
        if (!slug) throw new Error(`Invalid note name: ${JSON.stringify(name)}`)
        const docs = memoryDocsFor(projectId)
        const next = docs.filter((d) => d.name !== slug)
        next.push({ name: slug, content, updatedAt: now() })
        memoryHub.set(projectId, next)
        const note = assembleNote(next, slug)
        if (!note) throw new Error('Note write could not be read back.')
        return note
      },
      rename: async (projectId, from, to) => {
        const fromSlug = normalizeNoteName(from)
        const toSlug = normalizeNoteName(to)
        if (!fromSlug || !toSlug) throw new Error('Invalid note name.')
        const docs = memoryDocsFor(projectId)
        if (docs.some((d) => d.name === toSlug)) throw new Error(`A note named "${toSlug}" already exists.`)
        const next = docs.map((d) =>
          d.name === fromSlug
            ? { ...d, name: toSlug, updatedAt: now() }
            : { ...d, content: renameLinkTargets(d.content, fromSlug, toSlug) },
        )
        memoryHub.set(projectId, next)
        return assembleHubSnapshot(next)
      },
      trash: async (projectId, name) => {
        // Mirror the real service: invalid slugs are rejected, not ignored.
        const slug = normalizeNoteName(name)
        if (!slug) throw new Error(`Invalid note name: ${JSON.stringify(name)}`)
        const next = memoryDocsFor(projectId).filter((d) => d.name !== slug)
        memoryHub.set(projectId, next)
        return assembleHubSnapshot(next)
      },
      health: async (projectId) => assembleHealth(memoryDocsFor(projectId)),
      captureSession: async (projectId, sessionId, dryRun): Promise<CaptureResult> => {
        // The browser mock has no Claude CLI, so it synthesizes one demo proposal
        // (a "review" so the UI can exercise the queue) instead of distilling.
        const slug = `session-${sessionId.slice(0, 6)}-insight`
        const proposedContent = `---\nschema: 1\nname: ${slug}\ntitle: Insight from ${sessionId.slice(0, 6)}\nclass: decision\ngate: asked\nupdatedAt: ${now()}\n---\nA demo fact the mock distiller proposed from this session.\n`
        if (!dryRun) {
          const item: ReviewItem = {
            id: `rev-${Math.round(now().length + sessionId.length)}-${reviewsFor(projectId).length}`,
            brain: `project:${projectId}`,
            kind: 'new',
            slug,
            title: `Insight from ${sessionId.slice(0, 6)}`,
            proposedContent,
            reason: 'mock distiller was unsure — asking Baz',
            existingContent: null,
            sourceId: sessionId,
            alsoTrash: null,
            status: 'pending',
            createdAt: now(),
            resolvedAt: null,
          }
          mockReviews.set(projectId, [...reviewsFor(projectId), item])
        }
        return {
          proposals: [
            {
              scope: 'project',
              class: 'decision',
              slug,
              title: `Insight from ${sessionId.slice(0, 6)}`,
              gate: 'review',
              reconcile: 'new',
              similarity: 0,
              reason: 'mock distiller was unsure — asking Baz',
              proposedContent,
            },
          ],
          committed: 0,
          queued: dryRun ? 0 : 1,
          skipped: 0,
          nextOffset: 0,
          dryRun: !!dryRun,
        }
      },
      reviewQueue: async (projectId) => reviewsFor(projectId),
      resolveReview: async (projectId, reviewId, decision, editedContent) => {
        const item = reviewsFor(projectId).find((r) => r.id === reviewId)
        if (item && decision !== 'discard') {
          const content = decision === 'edit' && editedContent != null ? editedContent : item.proposedContent
          const docs = memoryDocsFor(projectId).filter((d) => d.name !== item.slug)
          docs.push({ name: item.slug, content, updatedAt: now() })
          memoryHub.set(projectId, docs)
        }
        mockReviews.set(projectId, reviewsFor(projectId).filter((r) => r.id !== reviewId))
        return reviewsFor(projectId)
      },
      ledger: async () => [],
      consolidate: async (projectId) => {
        const report = analyzeConsolidation(memoryDocsFor(projectId))
        return { report, queued: 0, snapshotId: `snap-${now().slice(0, 10)}` }
      },
      bazList: async () => assembleHubSnapshot(memoryDocsFor('baz-global')),
      bazRead: async (name) => assembleNote(memoryDocsFor('baz-global'), name),
    },
    swarm: {
      // Same kernel as the real SwarmService (single-rule principle): the
      // mock persists to a Map instead of SQLite, nothing else differs.
      board: async (projectId) => assembleBoard(kanbanFor(projectId)),
      createCard: async ({ projectId, title, body }) => {
        const cards = kanbanFor(projectId)
        const next: KanbanCard[] = [
          ...cards,
          {
            id: id('card'),
            projectId,
            title,
            body: body ?? '',
            status: 'todo',
            position: appendPosition(cards, 'todo'),
            role: null,
            persona: null,
            agent: null,
            assignments: [],
            pipelineStep: 0,
            councilSessionId: null,
            terminalSessionId: null,
            worktreePath: null,
            branch: null,
            createdAt: now(),
            updatedAt: now(),
          },
        ]
        kanbanSeed.set(projectId, next)
        return assembleBoard(next)
      },
      updateCard: async ({ projectId, cardId, title, body, role, persona, agent, assignments, councilSessionId }) => {
        const cards = kanbanFor(projectId)
        if (!cards.some((c) => c.id === cardId)) {
          throw new Error(`Card ${cardId} not found in this project.`)
        }
        const next = cards.map((c) =>
          c.id === cardId
            ? {
                ...c,
                title: title ?? c.title,
                body: body ?? c.body,
                role: role === undefined ? c.role : role,
                persona: persona === undefined ? c.persona : persona,
                agent: agent === undefined ? c.agent : agent,
                assignments: assignments === undefined ? c.assignments : assignments,
                // A changed pipeline restarts at step 0 (mock parity with main).
                pipelineStep: assignments === undefined ? c.pipelineStep : 0,
                councilSessionId: councilSessionId === undefined ? c.councilSessionId : councilSessionId,
                updatedAt: now(),
              }
            : c,
        )
        kanbanSeed.set(projectId, next)
        return assembleBoard(next)
      },
      moveCard: async ({ projectId, cardId, to, index }) => {
        const next = moveCardInList(kanbanFor(projectId), cardId, to, index, 'user', now())
        kanbanSeed.set(projectId, next)
        return assembleBoard(next)
      },
      removeCard: async ({ projectId, cardId }) => {
        const cards = kanbanFor(projectId)
        const card = cards.find((c) => c.id === cardId)
        if (!card) throw new Error(`Card ${cardId} not found in this project.`)
        if (card.status === 'in_progress') {
          throw new Error('Card has a running agent — kill or park it before deleting.')
        }
        const next = cards.filter((c) => c.id !== cardId)
        kanbanSeed.set(projectId, next)
        return assembleBoard(next)
      },
      startCard: async ({ projectId, cardId }) => {
        const cards = kanbanFor(projectId)
        const card = cards.find((c) => c.id === cardId)
        if (!card) throw new Error(`Card ${cardId} not found in this project.`)
        if (card.status !== 'todo' && card.status !== 'parked') {
          throw new Error('Only a To do or Parked card can start.')
        }
        if (cards.filter((c) => c.status === 'in_progress').length >= 3) {
          throw new Error('Concurrency cap reached (3) — park or finish a running card first.')
        }
        // Same worktree rule as main: create on first start, reuse on resume.
        const branch = card.branch ?? cardBranch(card.title, card.id)
        const workerSessionId = id('term')
        // Auto-assign at Start (mock parity with SwarmService.resolveAssignments):
        // an unassigned, un-named card is routed to a role pipeline from its text.
        const assignments: Assignment[] =
          card.assignments.length > 0
            ? card.assignments
            : card.agent
              ? []
              : classifyRoles(card.title, card.body).pipeline.map((p) => ({
                  role: p.role,
                  spec: p.spec ?? null,
                }))
        const startStep = Math.min(card.pipelineStep, Math.max(0, assignments.length - 1))
        const linked = cards.map((c) =>
          c.id === cardId
            ? {
                ...c,
                terminalSessionId: workerSessionId,
                branch,
                worktreePath: c.worktreePath ?? `/mock/worktrees/${branch.slice(6)}`,
                assignments,
                pipelineStep: startStep,
              }
            : c,
        )
        const next = moveCardInList(linked, cardId, 'in_progress', 0, 'service', now())
        kanbanSeed.set(projectId, next)
        // Simulated worker: streams a heartbeat while Running (feeds the
        // card's liveness row), then finishes after a short run so the board
        // polling shows the same Running → In review transition the real
        // done-signal drives.
        const workerLines = [
          'Reading the card and project hub…',
          'Scanning src/ for the relevant modules…',
          'Editing components…',
          'Running the test suite…',
        ]
        let step = 0
        const heartbeat = setInterval(() => {
          const stillRunning = kanbanFor(projectId).some(
            (c) => c.id === cardId && c.status === 'in_progress',
          )
          if (!stillRunning) {
            clearInterval(heartbeat)
            return
          }
          emit(workerSessionId, `\x1b[2m${workerLines[step % workerLines.length]}\x1b[0m\r\n`)
          step += 1
        }, 2_400)
        // Pipeline simulation: every ~6s the active step "finishes its turn",
        // advancing to the next role in place (same card, bumped step) — the
        // mock mirror of SwarmService.advanceOrFinish — then lands In review
        // after the last step, matching the real done-signal flow.
        const totalSteps = Math.max(1, assignments.length)
        let simStep = startStep
        const advance = setInterval(() => {
          const current = kanbanFor(projectId)
          const still = current.find((c) => c.id === cardId && c.status === 'in_progress')
          if (!still) {
            clearInterval(advance)
            return
          }
          if (simStep + 1 < totalSteps) {
            simStep += 1
            kanbanSeed.set(
              projectId,
              current.map((c) => (c.id === cardId ? { ...c, pipelineStep: simStep, updatedAt: now() } : c)),
            )
          } else {
            clearInterval(advance)
            kanbanSeed.set(projectId, moveCardInList(current, cardId, 'in_review', 0, 'service', now()))
          }
        }, 6_000)
        return assembleBoard(next)
      },
      agents: async (_projectId) => namedAgentsMock,
      parkCard: async ({ projectId, cardId }) => {
        const cards = kanbanFor(projectId)
        const card = cards.find((c) => c.id === cardId)
        if (!card) throw new Error(`Card ${cardId} not found in this project.`)
        if (card.status !== 'in_progress') throw new Error('Only a running card can be parked.')
        const next = moveCardInList(cards, cardId, 'parked', 0, 'service', now())
        kanbanSeed.set(projectId, next)
        return assembleBoard(next)
      },
      // Faz 2.5 — a plausible on-demand completion report (the same derivation the
      // real service runs: acceptance from the body, diff stat over the worktree).
      completionReport: async (projectId, cardId) => {
        const card = kanbanFor(projectId).find((c) => c.id === cardId)
        if (!card) throw new Error(`Card ${cardId} not found in this project.`)
        return {
          cardId: card.id,
          title: card.title,
          branch: card.branch,
          diffStat: card.worktreePath ? { files: 3, insertions: 42, deletions: 7 } : null,
          acceptance: extractAcceptanceCriteria(card.body),
          hasCouncilSpec: card.councilSessionId !== null,
          finishedAt: card.updatedAt,
        }
      },
      // The mock finishes cards via board polling, not push events, so this is a
      // no-op subscription (matching how the other push events are mocked).
      onCardCompleted: () => () => {},
    },
    sentinel: {
      list: async (projectId, opts) =>
        sentinelFor(projectId)
          .slice()
          .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
          .slice(0, opts?.limit ?? 50),
      markSeen: async (projectId, ids) => {
        const set = new Set(ids)
        let changed = 0
        const next = sentinelFor(projectId).map((s) => {
          if (set.has(s.id) && s.status === 'new') {
            changed += 1
            return { ...s, status: 'seen' as const }
          }
          return s
        })
        mockSentinel.set(projectId, next)
        return changed
      },
      unseenCount: async (projectId) =>
        sentinelFor(projectId).filter((s) => s.status === 'new').length,
      // The mock never pushes signals (no backend sensors), so this is a no-op
      // subscription — matching how the other push events are mocked.
      onAlert: () => () => {},
    },
    review: {
      // Staged review session so the surface is fully explorable in the
      // browser preview: a short "thinking" delay, then realistic findings.
      run: async (_projectId, opts) => {
        await new Promise((r) => setTimeout(r, 1100))
        return {
          ok: true,
          findings: [
            {
              severity: 'high' as const,
              file: 'components/Hero.tsx',
              line: 42,
              title: 'Unvalidated intake form payload reaches the API call',
              detail:
                'The submit handler posts `formData` without schema validation. A crafted payload can hit the backend unchecked — validate with the shared zod schema before posting.',
            },
            {
              severity: 'medium' as const,
              file: 'app/page.tsx',
              line: 18,
              title: 'useEffect fetch races project switches',
              detail:
                'The fetch result is applied without checking whether the component is still mounted for the same project — add an abort/cancelled guard.',
            },
            {
              severity: 'low' as const,
              file: 'styles/tokens.css',
              line: null,
              title: 'Duplicate --accent-2 definition',
              detail: 'The token is declared twice; the second silently wins. Remove one.',
            },
          ],
          raw: null,
          model: `Claude · ${resolveChatModel(opts?.model).label}`,
          error: null,
          stats: {
            filesReviewed: 4,
            filesBlocked: 1,
            filesSummarized: 1,
            injectionSuspects: 0,
            truncated: false,
            durationMs: 1100,
          },
        }
      },
      runText: async (_projectId, input, opts) => {
        await new Promise((r) => setTimeout(r, 900))
        return {
          ok: true,
          findings: [
            {
              severity: 'medium' as const,
              file: input.label,
              line: null,
              title: 'Exit-1 caused by a missing dev dependency',
              detail:
                'The output shows the failure starts at the first unresolved import — run the install step before re-running this command.',
            },
          ],
          raw: null,
          model: `Claude · ${resolveChatModel(opts?.model).label}`,
          error: null,
          stats: {
            filesReviewed: 1,
            filesBlocked: 0,
            filesSummarized: 0,
            injectionSuspects: 0,
            truncated: false,
            durationMs: 900,
          },
        }
      },
      diffStat: async (_projectId, _opts) => {
        await new Promise((r) => setTimeout(r, 250))
        return { files: 3, insertions: 42, deletions: 7 }
      },
    },
    council: {
      run: async (_projectId, opts) => {
        await new Promise((r) => setTimeout(r, 1600))
        if ((opts?.mode ?? 'diff') !== 'spec') return mockDiffCouncil()
        // A draft that already spells out acceptance criteria gates through.
        return /acceptance/i.test(opts?.spec ?? '') ? mockSpecCouncilApproved() : mockSpecCouncil()
      },
      // A plausible cross-session standing, best (lowest average rank) first —
      // enough for the browser preview to render the scorecard chips.
      scorecard: async (): Promise<ScorecardEntry[]> => [
        { seatId: 'first-principles', averageRank: 1.6, sessions: 8 },
        { seatId: 'builder', averageRank: 2.1, sessions: 8 },
        { seatId: 'contrarian', averageRank: 2.9, sessions: 8 },
        { seatId: 'outsider', averageRank: 3.4, sessions: 7 },
        { seatId: 'expansionist', averageRank: 4.2, sessions: 6 },
      ],
    },
    chat: {
      ask: async (_projectId, prompt, opts) => ({
        ok: true,
        text: `(browser preview) Bu mock yanıt — gerçek uygulamada Claude cevaplar.\n\nSoru: "${prompt.slice(0, 120)}"`,
        model: `Claude · ${resolveChatModel(opts?.model).label}`,
      }),
    },
    hermesChat: {
      // Canned per-project conversation so browser preview keeps working
      // without a real `hermes` binary. Mirrors the real backend's shape:
      // history is remembered until cleared.
      ask: async (projectId, message, imagePath) => {
        // A real turn is a full agentic loop that takes seconds-to-minutes; a
        // short preview delay keeps the "thinking" state honest in the browser.
        await new Promise((r) => setTimeout(r, 1200))
        const turns = mockHermesChats.get(projectId) ?? 0
        mockHermesChats.set(projectId, turns + 1)
        const imageNote = imagePath ? '\n\n(Bir görsel aldım — gerçek uygulamada inceleyebilirim.)' : ''
        return {
          ok: true,
          text: `(browser preview) Hermes burada — gerçek uygulamada orkestratör cevaplar.\n\nBu sohbetteki ${turns + 1}. mesajın: "${message.slice(0, 120)}"${imageNote}`,
        }
      },
      clear: async (projectId) => {
        mockHermesChats.delete(projectId)
      },
    },
    secrets: {
      // In-memory only for the browser preview — never persisted, and (like the
      // real bridge) the stored value is never readable back out.
      set: async (kind, value) => {
        mockSecrets.set(kind, value)
      },
      has: async (kind) => mockSecrets.has(kind),
      delete: async (kind) => {
        mockSecrets.delete(kind)
      },
    },
    audit: { list: async (projectId) => audit.filter((a) => a.projectId === projectId) },
    system: {
      info: async (): Promise<SystemInfo> => ({
        platform: 'darwin',
        appVersion: '0.1.0',
        electron: null,
        node: '22',
        isMock: true,
        cliAvailable: { claude: true, codex: true, railway: false, git: true, gh: true },
      }),
      // No native dialog in a plain browser — return a sample path for preview.
      chooseDirectory: async () => '/Users/baz/Documents/BAZ-WORK/sample-project',
    },
    appUpdate: {
      status: async () => appUpdateState,
      check: async () => {
        appUpdateState = { ...appUpdateState, phase: 'available', checkedAt: now() }
        appUpdateListeners.forEach((cb) => cb(appUpdateState))
        return appUpdateState
      },
      download: async () => {
        appUpdateState = { ...appUpdateState, phase: 'downloading', canDownload: false, progressPercent: 38 }
        appUpdateListeners.forEach((cb) => cb(appUpdateState))
        setTimeout(() => {
          appUpdateState = {
            ...appUpdateState,
            phase: 'downloaded',
            progressPercent: 100,
            canInstall: true,
            canDownload: false,
          }
          appUpdateListeners.forEach((cb) => cb(appUpdateState))
        }, 700)
        return appUpdateState
      },
      install: async () => {
        appUpdateState = { ...appUpdateState, phase: 'idle', currentVersion: appUpdateState.latestVersion ?? '0.1.1' }
      },
      refresh: async () => ({
        ok: false,
        message: 'Rebuild & relaunch is only available in the desktop app.',
      }),
      installRelease: async () => ({
        ok: false,
        message: 'Installing a release build is only available in the desktop app.',
      }),
      // Preview the button on the cockpit project only, matching the real
      // main-process identity check.
      refreshEligible: async (projectId) => projectId === 'prj_cockpit',
      onChange: (cb) => {
        appUpdateListeners.add(cb)
        return (() => appUpdateListeners.delete(cb)) as Unsubscribe
      },
    },
  }
}
