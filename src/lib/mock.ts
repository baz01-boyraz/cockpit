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
  AuditEntry,
  DashboardSnapshot,
  ErrorInsight,
  GitSnapshot,
  LogEvent,
  Project,
  ProjectConfig,
  RailwayConnection,
  RailwayService,
  TerminalOutputChunk,
  TerminalSession,
  UsageSummary,
} from '@shared/domain'
import type { CockpitApi, SystemInfo, Unsubscribe } from '@shared/ipc'
import { classifyRoute } from '@shared/router'
import { matchLogLine } from '@shared/log-patterns'

const now = () => new Date().toISOString()
const id = (p: string) => `${p}_${Math.random().toString(36).slice(2, 10)}`

const projects: Project[] = [
  {
    id: 'prj_serbest',
    name: 'Serbest Law Landing Page',
    path: '/Users/baz/dev/serbest-law',
    techStack: ['Next.js', 'Tailwind', 'FastAPI', 'PostgreSQL'],
    createdAt: now(),
    updatedAt: now(),
    lastOpenedAt: now(),
  },
  {
    id: 'prj_cockpit',
    name: 'Baz Developer Cockpit',
    path: '/Users/baz/Projects/baz-cockpit',
    techStack: ['Electron', 'React', 'TypeScript', 'Vite'],
    createdAt: now(),
    updatedAt: now(),
    lastOpenedAt: now(),
  },
]

const gitByProject: Record<string, GitSnapshot> = {
  prj_serbest: {
    id: id('git'),
    projectId: 'prj_serbest',
    branch: 'feature/hero-redesign',
    ahead: 2,
    behind: 0,
    changedFilesCount: 5,
    stagedCount: 2,
    unstagedCount: 2,
    untrackedCount: 1,
    files: [
      { path: 'app/page.tsx', state: 'staged', index: 'M', workingDir: ' ' },
      { path: 'components/Hero.tsx', state: 'staged', index: 'M', workingDir: ' ' },
      { path: 'components/Nav.tsx', state: 'unstaged', index: ' ', workingDir: 'M' },
      { path: 'styles/tokens.css', state: 'unstaged', index: ' ', workingDir: 'M' },
      { path: 'public/og-image.png', state: 'untracked', index: '?', workingDir: '?' },
    ],
    createdAt: now(),
  },
  prj_cockpit: {
    id: id('git'),
    projectId: 'prj_cockpit',
    branch: 'main',
    ahead: 0,
    behind: 0,
    changedFilesCount: 0,
    stagedCount: 0,
    unstagedCount: 0,
    untrackedCount: 0,
    files: [],
    createdAt: now(),
  },
}

const insights: ErrorInsight[] = [
  {
    id: id('ins'),
    projectId: 'prj_serbest',
    logEventId: null,
    title: 'Missing module',
    likelyCause: 'A required package or local import path is not installed or is misspelled.',
    suggestedAction: 'Run the install command (npm/pnpm/yarn install) or fix the import path.',
    suggestedAgent: 'codex',
    severity: 'high',
    matchedPattern: 'module_not_found',
    createdAt: now(),
  },
  {
    id: id('ins'),
    projectId: 'prj_serbest',
    logEventId: null,
    title: 'Port already in use',
    likelyCause: 'Another process is already bound to the dev/server port.',
    suggestedAction: 'Stop the other process or start the server on a different port.',
    suggestedAgent: 'local',
    severity: 'medium',
    matchedPattern: 'port_in_use',
    createdAt: now(),
  },
]

const approvals: ApprovalRequest[] = [
  {
    id: id('apr'),
    projectId: 'prj_serbest',
    actionType: 'git_push',
    riskLevel: 'high',
    summary: 'Push 2 commits to origin/feature/hero-redesign',
    payload: { remote: 'origin', branch: 'feature/hero-redesign', commits: 2 },
    status: 'pending',
    createdAt: now(),
    resolvedAt: null,
  },
]

const usage: UsageSummary[] = [
  { provider: 'terminal', sessions: 4, commands: 37, tasks: 0, totalDurationMs: 5_400_000, estimatedTokens: null, warning: null },
  { provider: 'claude', sessions: 3, commands: 0, tasks: 6, totalDurationMs: 2_100_000, estimatedTokens: 184_000, warning: null },
  { provider: 'codex', sessions: 2, commands: 0, tasks: 9, totalDurationMs: 1_250_000, estimatedTokens: 96_000, warning: null },
]

const logs: LogEvent[] = [
  { id: id('log'), projectId: 'prj_serbest', sourceType: 'terminal', sourceId: 't1', level: 'error', message: "Error: Cannot find module 'framer-motion'", metadata: {}, createdAt: now() },
  { id: id('log'), projectId: 'prj_serbest', sourceType: 'terminal', sourceId: 't1', level: 'warn', message: 'warning: port 3000 is already in use, trying 3001', metadata: {}, createdAt: now() },
  { id: id('log'), projectId: 'prj_serbest', sourceType: 'system', sourceId: null, level: 'info', message: 'Dev server ready on http://localhost:3001', metadata: {}, createdAt: now() },
]

const audit: AuditEntry[] = [
  { id: id('aud'), projectId: 'prj_serbest', actor: 'ai', actionType: 'router.classify', summary: 'Routed task to claude: "plan the hero section refactor"', payloadRedacted: {}, createdAt: now() },
  { id: id('aud'), projectId: 'prj_serbest', actor: 'user', actionType: 'terminal.create', summary: 'Created terminal "Dev server"', payloadRedacted: {}, createdAt: now() },
]

const terminals: Record<string, TerminalSession[]> = { prj_serbest: [], prj_cockpit: [] }
const dataListeners = new Set<(c: TerminalOutputChunk) => void>()
const approvalListeners = new Set<() => void>()

function emit(sessionId: string, data: string) {
  for (const cb of dataListeners) cb({ sessionId, data, at: now() })
}

const BANNER = [
  '\x1b[38;5;208m›\x1b[0m baz-cockpit mock shell — \x1b[2mElectron not detected (browser preview)\x1b[0m',
  '\x1b[2m$\x1b[0m npm run dev',
  '\x1b[38;5;150m✓\x1b[0m ready on \x1b[4mhttp://localhost:3001\x1b[0m',
  '',
]

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

function dashboardFor(projectId: string): DashboardSnapshot {
  const project = projects.find((p) => p.id === projectId) ?? projects[0]
  const git = gitByProject[projectId]
  const terms = terminals[projectId] ?? []
  return {
    project,
    branch: git?.branch ?? null,
    changedFiles: git?.changedFilesCount ?? 0,
    terminalCount: terms.length,
    runningTerminals: terms.filter((t) => t.status === 'running').length,
    agentCount: terms.filter((t) => t.role === 'claude' || t.role === 'codex').length,
    railwayConnected: false,
    railwayServices: 3,
    recentErrors: insights.filter((i) => i.projectId === projectId).slice(0, 5),
    pendingApprovals: approvals.filter((a) => a.projectId === projectId && a.status === 'pending').length,
    usage: projectId === 'prj_serbest' ? usage : [],
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
          cwd: '.',
          shell: '/bin/zsh',
          status: 'running',
          pid: Math.floor(Math.random() * 90000) + 1000,
          exitCode: null,
          createdAt: now(),
          lastActiveAt: now(),
        }
        list.push(session)
        setTimeout(() => BANNER.forEach((l, i) => setTimeout(() => emit(session.id, l + '\r\n'), i * 90)), 120)
        return session
      },
      write: async (sessionId, data) => {
        if (data.includes('\r')) emit(sessionId, '\r\n\x1b[2m(mock shell — command echoed in browser preview)\x1b[0m\r\n')
        else emit(sessionId, data)
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
      rename: async (sessionId, name, role) => {
        let found: TerminalSession | undefined
        for (const list of Object.values(terminals)) found = list.find((s) => s.id === sessionId) ?? found
        if (found) {
          found.name = name
          if (role !== undefined) found.role = role
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
      onData: (cb) => {
        dataListeners.add(cb)
        return (() => dataListeners.delete(cb)) as Unsubscribe
      },
      onExit: () => (() => {}) as Unsubscribe,
    },
    git: {
      status: async (projectId) => gitByProject[projectId] ?? gitByProject.prj_cockpit,
      diff: async ({ path }) => ({
        path,
        binary: false,
        hunks: `diff --git a/${path} b/${path}\n@@ -12,7 +12,9 @@\n-  <h1 className="text-3xl">Serbest Law</h1>\n+  <h1 className="text-5xl tracking-tight font-semibold">\n+    Serbest Law\n+  </h1>\n   <p className="text-stone-400">Trusted counsel for modern business.</p>`,
      }),
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
      insights: async (projectId) => insights.filter((i) => i.projectId === projectId),
      ingest: async ({ message }) => {
        const m = matchLogLine(message)
        if (!m) return null
        const insight: ErrorInsight = {
          id: id('ins'),
          projectId: 'prj_serbest',
          logEventId: null,
          title: m.title,
          likelyCause: m.likelyCause,
          suggestedAction: m.suggestedAction,
          suggestedAgent: m.suggestedAgent,
          severity: m.severity,
          matchedPattern: m.pattern,
          createdAt: now(),
        }
        insights.unshift(insight)
        return insight
      },
    },
    usage: { summary: async (projectId) => (projectId === 'prj_serbest' ? usage : []) },
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
    chat: {
      ask: async (_projectId, prompt) => ({
        ok: true,
        text: `(browser preview) Bu mock yanıt. Gerçek uygulamada bu, projenin Claude Code CLI'ı (Opus 4.8) tarafından yanıtlanır.\n\nSorun: "${prompt.slice(0, 120)}"`,
        model: 'mock',
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
        cliAvailable: { claude: true, codex: true, railway: false, git: true },
      }),
      // No native dialog in a plain browser — return a sample path for preview.
      chooseDirectory: async () => '/Users/baz/Documents/BAZ-WORK/sample-project',
    },
  }
}
