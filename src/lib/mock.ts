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
  GitSnapshot,
  Project,
  ProjectConfig,
  RailwayConnection,
  RailwayService,
  TerminalOutputChunk,
  TerminalSession,
} from '@shared/domain'
import type { CockpitApi, SystemInfo, Unsubscribe } from '@shared/ipc'
import { resolveChatModel } from '@shared/chat-models'
import { assembleDashboard, countActiveAgents } from '@shared/dashboard-assembly'
import { aggregateInsights, insightFromMatch } from '@shared/insight-aggregation'
import { assembleHubSnapshot, assembleNote, type MemoryDoc } from '@shared/memory-hub'
import {
  appendPosition,
  assembleBoard,
  cardBranch,
  moveCardInList,
  type KanbanCard,
} from '@shared/kanban'
import { normalizeNoteName, renameLinkTargets } from '@shared/wikilink'
import { classifyRoute } from '@shared/router'
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
  now,
  projects,
  usage,
} from './mockData'

const gitState = new Map<string, GitSnapshot>()

function gitSnapshotFor(projectId: string): GitSnapshot {
  const current = gitState.get(projectId)
  if (current) return current
  const seed = gitSeeds[projectId] ?? gitSeeds.prj_cockpit
  const fresh: GitSnapshot = { ...seed, files: seed.files.map((f) => ({ ...f })) }
  gitState.set(projectId, fresh)
  return fresh
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
      status: async (projectId) => githubByProject[projectId] ?? githubByProject.prj_cockpit,
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
      updateCard: async ({ projectId, cardId, title, body, role, persona }) => {
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
        const linked = cards.map((c) =>
          c.id === cardId
            ? {
                ...c,
                terminalSessionId: id('term'),
                branch,
                worktreePath: c.worktreePath ?? `/mock/worktrees/${branch.slice(6)}`,
              }
            : c,
        )
        const next = moveCardInList(linked, cardId, 'in_progress', 0, 'service', now())
        kanbanSeed.set(projectId, next)
        // Simulated worker: finishes after a short run so the board polling
        // shows the same Running → In review transition the real exit drives.
        setTimeout(() => {
          const current = kanbanFor(projectId)
          const still = current.find((c) => c.id === cardId && c.status === 'in_progress')
          if (!still) return
          kanbanSeed.set(
            projectId,
            moveCardInList(current, cardId, 'in_review', 0, 'service', now()),
          )
        }, 15_000)
        return assembleBoard(next)
      },
      parkCard: async ({ projectId, cardId }) => {
        const cards = kanbanFor(projectId)
        const card = cards.find((c) => c.id === cardId)
        if (!card) throw new Error(`Card ${cardId} not found in this project.`)
        if (card.status !== 'in_progress') throw new Error('Only a running card can be parked.')
        const next = moveCardInList(cards, cardId, 'parked', 0, 'service', now())
        kanbanSeed.set(projectId, next)
        return assembleBoard(next)
      },
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
    },
    chat: {
      ask: async (_projectId, prompt, opts) => ({
        ok: true,
        text: `(browser preview) Bu mock yanıt — gerçek uygulamada Claude cevaplar.\n\nSoru: "${prompt.slice(0, 120)}"`,
        model: `Claude · ${resolveChatModel(opts?.model).label}`,
      }),
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
