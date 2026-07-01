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
  AgentUsageReport,
  ApprovalRequest,
  AuditEntry,
  ClaudeSessionSummary,
  DashboardSnapshot,
  ErrorInsight,
  AppUpdateState,
  GitCommitResult,
  GitHubRepositoryStatus,
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
import { resolveChatModel } from '@shared/chat-models'
import { classifyRoute } from '@shared/router'
import { matchLogLine } from '@shared/log-patterns'

const now = () => new Date().toISOString()
const ago = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString()
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
    name: 'cockpiT',
    path: '/Users/baz/Projects/cockpit',
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

const githubByProject: Record<string, GitHubRepositoryStatus> = {
  prj_serbest: {
    connected: true,
    authState: 'authenticated',
    account: {
      login: 'baz01-boyraz',
      name: 'Baz',
      avatarUrl: null,
      htmlUrl: 'https://github.com/baz01-boyraz',
    },
    remote: {
      name: 'origin',
      url: 'git@github.com:baz01-boyraz/serbest-law.git',
      provider: 'github',
      owner: 'baz01-boyraz',
      repo: 'serbest-law',
      webUrl: 'https://github.com/baz01-boyraz/serbest-law',
    },
    repository: {
      owner: 'baz01-boyraz',
      name: 'serbest-law',
      fullName: 'baz01-boyraz/serbest-law',
      private: true,
      defaultBranch: 'main',
      htmlUrl: 'https://github.com/baz01-boyraz/serbest-law',
      description: 'Client-facing legal intake site.',
    },
    openPullRequest: {
      number: 18,
      title: 'Refine hero and intake conversion path',
      state: 'open',
      htmlUrl: 'https://github.com/baz01-boyraz/serbest-law/pull/18',
      draft: false,
    },
    latestWorkflowRun: {
      id: 1042,
      name: 'Preview',
      status: 'completed',
      conclusion: 'success',
      htmlUrl: 'https://github.com/baz01-boyraz/serbest-law/actions/runs/1042',
      createdAt: now(),
    },
    latestRelease: null,
    error: null,
    fetchedAt: now(),
  },
  prj_cockpit: {
    connected: true,
    authState: 'invalid',
    account: null,
    remote: {
      name: 'origin',
      url: 'https://github.com/baz01-boyraz/cockpit.git',
      provider: 'github',
      owner: 'baz01-boyraz',
      repo: 'cockpit',
      webUrl: 'https://github.com/baz01-boyraz/cockpit',
    },
    repository: {
      owner: 'baz01-boyraz',
      name: 'cockpit',
      fullName: 'baz01-boyraz/cockpit',
      private: null,
      defaultBranch: null,
      htmlUrl: 'https://github.com/baz01-boyraz/cockpit',
      description: null,
    },
    openPullRequest: null,
    latestWorkflowRun: null,
    latestRelease: {
      tagName: 'v0.1.0',
      name: 'First private beta',
      htmlUrl: 'https://github.com/baz01-boyraz/cockpit/releases/tag/v0.1.0',
      publishedAt: now(),
    },
    error: 'GitHub CLI auth is invalid. Run gh auth login to reconnect.',
    fetchedAt: now(),
  },
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

// Raw occurrences (one row per matched line), mirroring the SQLite `error_insights`
// table. listInsightsMock() aggregates these into one entry per pattern the same
// way LogIntelligenceService does, so the web/screenshot bridge stays honest:
// the seed spans an "active" failure, a "recent" one, and an older "earlier" one.
const insightEvents: ErrorInsight[] = [
  occurrence('build_failed', 'Build failed', 'The bundler/compiler rejected the current source.', 'Inspect the first error in the build output and resolve it before retrying.', 'codex', 'high', now()),
  occurrence('build_failed', 'Build failed', 'The bundler/compiler rejected the current source.', 'Inspect the first error in the build output and resolve it before retrying.', 'codex', 'high', ago(2)),
  occurrence('port_in_use', 'Port already in use', 'Another process is already bound to the dev/server port.', 'Stop the other process or start the server on a different port.', 'local', 'medium', ago(25)),
  occurrence('port_in_use', 'Port already in use', 'Another process is already bound to the dev/server port.', 'Stop the other process or start the server on a different port.', 'local', 'medium', ago(41)),
  occurrence('module_not_found', 'Missing module', 'A required package or local import path is not installed or is misspelled.', 'Run the install command (npm/pnpm/yarn install) or fix the import path.', 'codex', 'high', ago(185)),
  occurrence('module_not_found', 'Missing module', 'A required package or local import path is not installed or is misspelled.', 'Run the install command (npm/pnpm/yarn install) or fix the import path.', 'codex', 'high', ago(420)),
]

function occurrence(
  pattern: string,
  title: string,
  likelyCause: string,
  suggestedAction: string,
  suggestedAgent: ErrorInsight['suggestedAgent'],
  severity: ErrorInsight['severity'],
  createdAt: string,
): ErrorInsight {
  return {
    id: id('ins'),
    projectId: 'prj_serbest',
    logEventId: null,
    title,
    likelyCause,
    suggestedAction,
    suggestedAgent,
    severity,
    matchedPattern: pattern,
    createdAt,
    firstSeenAt: createdAt,
    lastSeenAt: createdAt,
    occurrences: 1,
  }
}

// pattern -> newest occurrence's createdAt that the user dismissed (per project,
// keyed `${projectId}::${pattern}`). A newer occurrence resurfaces the insight.
const insightDismissals = new Map<string, string>()
const dismissKey = (projectId: string, pattern: string) => `${projectId}::${pattern}`

/** Aggregate raw occurrences into one entry per pattern, honouring dismissals. */
function listInsightsMock(projectId: string): ErrorInsight[] {
  const byPattern = new Map<string, ErrorInsight>()
  for (const e of insightEvents) {
    if (e.projectId !== projectId) continue
    const existing = byPattern.get(e.matchedPattern)
    if (!existing) {
      byPattern.set(e.matchedPattern, { ...e })
      continue
    }
    const firstSeenAt = e.createdAt < existing.firstSeenAt ? e.createdAt : existing.firstSeenAt
    const newer = e.createdAt > existing.lastSeenAt
    byPattern.set(e.matchedPattern, {
      ...(newer ? e : existing),
      firstSeenAt,
      lastSeenAt: newer ? e.createdAt : existing.lastSeenAt,
      occurrences: existing.occurrences + 1,
    })
  }
  const out: ErrorInsight[] = []
  for (const insight of byPattern.values()) {
    const dismissedUpTo = insightDismissals.get(dismissKey(projectId, insight.matchedPattern))
    if (dismissedUpTo && insight.lastSeenAt <= dismissedUpTo) continue
    out.push(insight)
  }
  return out.sort((a, b) => (a.lastSeenAt < b.lastSeenAt ? 1 : a.lastSeenAt > b.lastSeenAt ? -1 : 0))
}

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

// Account-quota snapshots for the browser preview. Claude shows a healthy live
// state; Codex shows the warning tier so the screenshot exercises both tones.
const agentUsageReport = (): AgentUsageReport => ({
  providers: [
    {
      provider: 'claude',
      label: 'Claude',
      available: true,
      plan: 'Pro',
      windows: [
        { label: 'Session', usedPercent: 11, resetAt: new Date(Date.now() + 2.4 * 3600_000).toISOString() },
        { label: 'Weekly', usedPercent: 23, resetAt: new Date(Date.now() + 38 * 3600_000).toISOString() },
      ],
      reason: null,
      fetchedAt: now(),
    },
    {
      provider: 'codex',
      label: 'Codex',
      available: true,
      plan: 'Pro Lite',
      windows: [
        { label: 'Session', usedPercent: 82, resetAt: new Date(Date.now() + 1.1 * 3600_000).toISOString() },
        { label: 'Weekly', usedPercent: 64, resetAt: new Date(Date.now() + 72 * 3600_000).toISOString() },
      ],
      reason: null,
      fetchedAt: now(),
    },
  ],
})

const logs: LogEvent[] = [
  { id: id('log'), projectId: 'prj_serbest', sourceType: 'terminal', sourceId: 't1', level: 'error', message: "Error: Cannot find module 'framer-motion'", metadata: {}, createdAt: now() },
  { id: id('log'), projectId: 'prj_serbest', sourceType: 'terminal', sourceId: 't1', level: 'warn', message: 'warning: port 3000 is already in use, trying 3001', metadata: {}, createdAt: now() },
  { id: id('log'), projectId: 'prj_serbest', sourceType: 'system', sourceId: null, level: 'info', message: 'Dev server ready on http://localhost:3001', metadata: {}, createdAt: now() },
]

const audit: AuditEntry[] = [
  { id: id('aud'), projectId: 'prj_serbest', actor: 'ai', actionType: 'router.classify', summary: 'Routed task to claude: "plan the hero section refactor"', payloadRedacted: {}, createdAt: ago(2) },
  { id: id('aud'), projectId: 'prj_serbest', actor: 'user', actionType: 'git.push', summary: 'Pushed main to origin', payloadRedacted: {}, createdAt: ago(7) },
  { id: id('aud'), projectId: 'prj_serbest', actor: 'ai', actionType: 'router.classify', summary: 'Routed task to codex: "fix the failing module import"', payloadRedacted: {}, createdAt: ago(14) },
  { id: id('aud'), projectId: 'prj_serbest', actor: 'user', actionType: 'terminal.create', summary: 'Created terminal "Dev server"', payloadRedacted: {}, createdAt: ago(26) },
  { id: id('aud'), projectId: 'prj_serbest', actor: 'ai', actionType: 'router.classify', summary: 'Routed task to chat: "explain the redaction flow"', payloadRedacted: {}, createdAt: ago(41) },
  { id: id('aud'), projectId: 'prj_serbest', actor: 'system', actionType: 'audit.redact', summary: 'Masked 3 secrets before sending context', payloadRedacted: {}, createdAt: ago(58) },
  { id: id('aud'), projectId: 'prj_serbest', actor: 'ai', actionType: 'router.classify', summary: 'Routed task to claude: "review the usage dock styles"', payloadRedacted: {}, createdAt: ago(72) },
  { id: id('aud'), projectId: 'prj_serbest', actor: 'user', actionType: 'terminal.create', summary: 'Created terminal "Codex"', payloadRedacted: {}, createdAt: ago(96) },
]

const terminals: Record<string, TerminalSession[]> = { prj_serbest: [], prj_cockpit: [] }

const claudeSessionsMock: ClaudeSessionSummary[] = [
  { id: 'd90ddd0d-0e6a-4868-9213-d0da10c064d1', title: 'Terminal sessions: hatırlama + Obsidian capture tasarımı', createdAt: ago(90), lastActiveAt: ago(4), sizeBytes: 2_900_000 },
  { id: '3c9c7006-30d9-4681-8ff8-6c787b737cd4', title: 'usage pill\'e biraz daha depth ekleyip metalik yapalım', createdAt: ago(280), lastActiveAt: ago(180), sizeBytes: 5_900_000 },
  { id: 'a4788b72-c9b9-47ee-bd5c-5b6e9c9e52e5', title: 'son release sonrası gözüme batanlar', createdAt: ago(360), lastActiveAt: ago(300), sizeBytes: 5_600_000 },
  { id: 'de4abd0b-1a2b-4c3d-9e8f-7a6b5c4d3e2f', title: 'chat mode\'u şimdilik kaldırmak istiyorum', createdAt: ago(520), lastActiveAt: ago(420), sizeBytes: 1_200_000 },
]
const dataListeners = new Set<(c: TerminalOutputChunk) => void>()
const approvalListeners = new Set<() => void>()
const appUpdateListeners = new Set<(s: AppUpdateState) => void>()

function emit(sessionId: string, data: string) {
  for (const cb of dataListeners) cb({ sessionId, data, at: now() })
}

const BANNER = [
  '\x1b[38;5;208m›\x1b[0m cockpit mock shell — \x1b[2mElectron not detected (browser preview)\x1b[0m',
  '',
]

// --- Command blocks (OSC 133) demo -------------------------------------------
// The browser mock has no real shell, so it scripts a short session framed with
// OSC 133 semantic-prompt marks. This makes the Warp-style command-block
// decorations visible in the localhost screenshot workflow (success, failure,
// and a still-running command) exactly as a real zsh shell would drive them.
const MOCK_PROMPT = '\x1b[38;5;208m~/baz/serbest\x1b[0m \x1b[38;5;150m❯\x1b[0m '

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

interface MockCommand {
  command: string
  lines: string[]
  exitCode: number | null
  /** Simulated run time between output-start (C) and command-end (D). */
  runMs: number
}

const MOCK_SESSION: MockCommand[] = [
  {
    command: 'npm run build',
    lines: [
      '\x1b[2m> vite build\x1b[0m',
      '\x1b[38;5;150m✓\x1b[0m 42 modules transformed',
      '\x1b[38;5;150m✓\x1b[0m built in 1.24s',
    ],
    exitCode: 0,
    runMs: 1240,
  },
  {
    command: 'npm test',
    lines: [
      '\x1b[2m> vitest run\x1b[0m',
      '\x1b[38;5;150m✓\x1b[0m redaction (12)',
      '\x1b[38;5;196m✗\x1b[0m usage summary — expected 3, got 2',
      '\x1b[38;5;196m1 failed\x1b[0m, 40 passed',
    ],
    exitCode: 1,
    runMs: 820,
  },
  {
    command: 'npm run dev',
    lines: ['\x1b[2m> vite\x1b[0m', '\x1b[38;5;150m➜\x1b[0m Local:  \x1b[4mhttp://localhost:3001\x1b[0m'],
    exitCode: null,
    runMs: 500,
  },
]

// Play the scripted session on a timeline so each command has a realistic
// duration (C→D gap) and the terminal feels live: prompt + command appear, then
// the output and exit land after `runMs`. A `null` exit leaves the last command
// running, so the Blocks view shows a live "running" card.
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
    recentErrors: listInsightsMock(projectId).slice(0, 5),
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
      status: async (projectId) => gitByProject[projectId] ?? gitByProject.prj_cockpit,
      diff: async ({ path }) => ({
        path,
        binary: false,
        hunks: `diff --git a/${path} b/${path}\n@@ -12,7 +12,9 @@\n-  <h1 className="text-3xl">Serbest Law</h1>\n+  <h1 className="text-5xl tracking-tight font-semibold">\n+    Serbest Law\n+  </h1>\n   <p className="text-stone-400">Trusted counsel for modern business.</p>`,
      }),
      stage: async ({ projectId }) => {
        const snapshot = gitByProject[projectId] ?? gitByProject.prj_cockpit
        snapshot.files = snapshot.files.map((file) =>
          file.state === 'staged'
            ? file
            : { ...file, state: 'staged', index: file.workingDir.trim() || 'A', workingDir: ' ' },
        )
        snapshot.stagedCount = snapshot.files.length
        snapshot.unstagedCount = 0
        snapshot.untrackedCount = 0
        return snapshot
      },
      commit: async ({ projectId, message }): Promise<GitCommitResult> => {
        const snapshot = gitByProject[projectId] ?? gitByProject.prj_cockpit
        const filesChanged = snapshot.stagedCount
        snapshot.ahead += 1
        snapshot.changedFilesCount = 0
        snapshot.stagedCount = 0
        snapshot.unstagedCount = 0
        snapshot.untrackedCount = 0
        snapshot.files = []
        return { branch: snapshot.branch, commitHash: 'mock1234', summary: message, filesChanged }
      },
      push: async ({ projectId, force }) => {
        const snapshot = gitByProject[projectId] ?? gitByProject.prj_cockpit
        snapshot.ahead = 0
        return {
          branch: snapshot.branch,
          remote: 'origin',
          forced: Boolean(force),
          ahead: 0,
          behind: snapshot.behind,
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
        const insight = occurrence(
          m.pattern,
          m.title,
          m.likelyCause,
          m.suggestedAction,
          m.suggestedAgent,
          m.severity,
          now(),
        )
        const scoped: ErrorInsight = { ...insight, projectId }
        insightEvents.unshift(scoped)
        return scoped
      },
      dismissInsight: async (projectId, matchedPattern) => {
        const upTo = insightEvents
          .filter((e) => e.projectId === projectId && e.matchedPattern === matchedPattern)
          .reduce((max, e) => (e.createdAt > max ? e.createdAt : max), '')
        insightDismissals.set(dismissKey(projectId, matchedPattern), upTo || now())
      },
      clearInsights: async (projectId) => {
        for (const insight of listInsightsMock(projectId)) {
          insightDismissals.set(dismissKey(projectId, insight.matchedPattern), insight.lastSeenAt)
        }
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
      onChange: (cb) => {
        appUpdateListeners.add(cb)
        return (() => appUpdateListeners.delete(cb)) as Unsubscribe
      },
    },
  }
}
