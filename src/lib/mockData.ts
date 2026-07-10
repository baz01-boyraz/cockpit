/**
 * Seed data for the in-browser mock (split out of mock.ts to keep both files
 * under the 800-line cap). Pure data + tiny helpers only — all behavior stays
 * in mock.ts. The exported Maps are module singletons the mock mutates by
 * REPLACING entries (never mutating seed objects).
 */
import type {
  AgentUsageReport,
  ApprovalRequest,
  AuditEntry,
  ClaudeSessionSummary,
  ErrorInsight,
  GitHubRepositoryStatus,
  GitSnapshot,
  LogEvent,
  OpenRouterUsageSnapshot,
  Project,
  ResumableSessionSummary,
  UsageSummary,
} from '@shared/domain'
import { insightFromMatch } from '@shared/insight-aggregation'
import type { MemoryDoc } from '@shared/memory-hub'
import type { KanbanCard } from '@shared/kanban'
import type { NamedAgentSummary } from '@shared/named-agents'

export const now = () => new Date().toISOString()
export const ago = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString()
export const id = (p: string) => `${p}_${Math.random().toString(36).slice(2, 10)}`

export const projects: Project[] = [
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

// Immutable seed snapshots — NEVER mutated. Git actions operate on `gitState`
// (below), whose entries are replaced with fresh objects on every operation.
export const gitSeeds: Record<string, GitSnapshot> = {
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

// Current per-project snapshots. Entries are REPLACED (spread) by git actions;
// the seed objects above stay pristine across renders and operations.

export const githubByProject: Record<string, GitHubRepositoryStatus> = {
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

// Raw occurrences (one row per matched line), mirroring the SQLite `error_insights`
// table. listInsightsMock() aggregates these through the SAME shared function
// LogIntelligenceService uses, so the web/screenshot bridge stays honest:
// the seed spans an "active" failure, a "recent" one, and an older "earlier" one.
export const insightEvents: ErrorInsight[] = [
  occurrence('build_failed', 'Build failed', 'The bundler/compiler rejected the current source.', 'Inspect the first error in the build output and resolve it before retrying.', 'codex', 'high', now()),
  occurrence('build_failed', 'Build failed', 'The bundler/compiler rejected the current source.', 'Inspect the first error in the build output and resolve it before retrying.', 'codex', 'high', ago(2)),
  occurrence('port_in_use', 'Port already in use', 'Another process is already bound to the dev/server port.', 'Stop the other process or start the server on a different port.', 'local', 'medium', ago(25)),
  occurrence('port_in_use', 'Port already in use', 'Another process is already bound to the dev/server port.', 'Stop the other process or start the server on a different port.', 'local', 'medium', ago(41)),
  occurrence('module_not_found', 'Missing module', 'A required package or local import path is not installed or is misspelled.', 'Run the install command (npm/pnpm/yarn install) or fix the import path.', 'codex', 'high', ago(185)),
  occurrence('module_not_found', 'Missing module', 'A required package or local import path is not installed or is misspelled.', 'Run the install command (npm/pnpm/yarn install) or fix the import path.', 'codex', 'high', ago(420)),
]

export function occurrence(
  pattern: string,
  title: string,
  likelyCause: string,
  suggestedAction: string,
  suggestedAgent: ErrorInsight['suggestedAgent'],
  severity: ErrorInsight['severity'],
  createdAt: string,
): ErrorInsight {
  return insightFromMatch(
    { pattern, title, likelyCause, suggestedAction, suggestedAgent, severity },
    { id: id('ins'), projectId: 'prj_serbest', createdAt },
  )
}

// Per-project dismissal watermarks: pattern -> newest occurrence's createdAt
// the user dismissed. A newer occurrence resurfaces the insight.

export const approvals: ApprovalRequest[] = [
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

export const usage: UsageSummary[] = [
  { provider: 'terminal', sessions: 4, commands: 37, tasks: 0, totalDurationMs: 5_400_000, estimatedTokens: null, warning: null },
  { provider: 'claude', sessions: 3, commands: 0, tasks: 6, totalDurationMs: 2_100_000, estimatedTokens: 184_000, warning: null },
  { provider: 'codex', sessions: 2, commands: 0, tasks: 9, totalDurationMs: 1_250_000, estimatedTokens: 96_000, warning: null },
]

// Account-quota snapshots for the browser preview. Claude shows a healthy live
// state; Codex shows the warning tier so the screenshot exercises both tones.
export const agentUsageReport = (): AgentUsageReport => ({
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

// Live OpenRouter credit for the Hermes engine core, browser-preview edition.
export const openRouterUsageSnapshot = (): OpenRouterUsageSnapshot => ({
  available: true,
  remainingPercent: 62,
  remainingUsd: 12.4,
  totalUsd: 20,
  reason: null,
  fetchedAt: now(),
})

export const logs: LogEvent[] = [
  { id: id('log'), projectId: 'prj_serbest', sourceType: 'terminal', sourceId: 't1', level: 'error', message: "Error: Cannot find module 'framer-motion'", metadata: {}, createdAt: now() },
  { id: id('log'), projectId: 'prj_serbest', sourceType: 'terminal', sourceId: 't1', level: 'warn', message: 'warning: port 3000 is already in use, trying 3001', metadata: {}, createdAt: now() },
  { id: id('log'), projectId: 'prj_serbest', sourceType: 'system', sourceId: null, level: 'info', message: 'Dev server ready on http://localhost:3001', metadata: {}, createdAt: now() },
]

export const audit: AuditEntry[] = [
  { id: id('aud'), projectId: 'prj_serbest', actor: 'ai', actionType: 'router.classify', summary: 'Routed task to claude: "plan the hero section refactor"', payloadRedacted: {}, createdAt: ago(2) },
  { id: id('aud'), projectId: 'prj_serbest', actor: 'user', actionType: 'git.push', summary: 'Pushed main to origin', payloadRedacted: {}, createdAt: ago(7) },
  { id: id('aud'), projectId: 'prj_serbest', actor: 'ai', actionType: 'router.classify', summary: 'Routed task to codex: "fix the failing module import"', payloadRedacted: {}, createdAt: ago(14) },
  { id: id('aud'), projectId: 'prj_serbest', actor: 'user', actionType: 'terminal.create', summary: 'Created terminal "Dev server"', payloadRedacted: {}, createdAt: ago(26) },
  { id: id('aud'), projectId: 'prj_serbest', actor: 'ai', actionType: 'router.classify', summary: 'Routed task to chat: "explain the redaction flow"', payloadRedacted: {}, createdAt: ago(41) },
  { id: id('aud'), projectId: 'prj_serbest', actor: 'system', actionType: 'audit.redact', summary: 'Masked 3 secrets before sending context', payloadRedacted: {}, createdAt: ago(58) },
  { id: id('aud'), projectId: 'prj_serbest', actor: 'ai', actionType: 'router.classify', summary: 'Routed task to claude: "review the usage dock styles"', payloadRedacted: {}, createdAt: ago(72) },
  { id: id('aud'), projectId: 'prj_serbest', actor: 'user', actionType: 'terminal.create', summary: 'Created terminal "Codex"', payloadRedacted: {}, createdAt: ago(96) },
]

export const claudeSessionsMock: ClaudeSessionSummary[] = [
  { id: 'd90ddd0d-0e6a-4868-9213-d0da10c064d1', title: 'Terminal sessions: hatırlama + Obsidian capture tasarımı', createdAt: ago(90), lastActiveAt: ago(4), sizeBytes: 2_900_000 },
  { id: '3c9c7006-30d9-4681-8ff8-6c787b737cd4', title: 'usage pill\'e biraz daha depth ekleyip metalik yapalım', createdAt: ago(280), lastActiveAt: ago(180), sizeBytes: 5_900_000 },
  { id: 'a4788b72-c9b9-47ee-bd5c-5b6e9c9e52e5', title: 'son release sonrası gözüme batanlar', createdAt: ago(360), lastActiveAt: ago(300), sizeBytes: 5_600_000 },
  { id: 'de4abd0b-1a2b-4c3d-9e8f-7a6b5c4d3e2f', title: 'chat mode\'u şimdilik kaldırmak istiyorum', createdAt: ago(520), lastActiveAt: ago(420), sizeBytes: 1_200_000 },
]

export const resumableSessionsMock: ResumableSessionSummary[] = [
  ...claudeSessionsMock.map(
    (session): ResumableSessionSummary => ({ ...session, provider: 'claude' }),
  ),
  {
    id: 'f59b98ab-642e-4cad-b690-2e6f6256cc88',
    provider: 'codex' as const,
    title: 'Unify Claude and Codex Resume sessions',
    createdAt: ago(75),
    lastActiveAt: ago(2),
    sizeBytes: 840_000,
  },
].sort((a, b) => b.lastActiveAt.localeCompare(a.lastActiveAt))

// Seeded per-project knowledge hub — interlinked so backlinks, unresolved
// targets, and the graph are all explorable in the browser preview.
export const memoryHub = new Map<string, MemoryDoc[]>([
  [
    'prj_cockpit',
    [
      {
        name: 'vision-roadmap',
        content:
          '# Vision Roadmap\nMaster plan lives in docs/cockpit-VISION.md. Built so far: [[command-blocks]], [[diff-review]]. Next: [[memory-graph]] then [[swarm-ideas]].',
        updatedAt: ago(30),
      },
      {
        name: 'command-blocks',
        content:
          '# Command Blocks\nWarp-style foldable blocks over OSC 133. Bridges into [[diff-review]] via the per-block review action. Part of [[vision-roadmap]].',
        updatedAt: ago(60 * 26),
      },
      {
        name: 'diff-review',
        content:
          '# Diff Review\nPre-ship AI review through the sanitizer boundary. Found its own first bug while dogfooding — see [[vision-roadmap]]. Feeds [[swarm-ideas]] reviewer roles.',
        updatedAt: ago(60 * 3),
      },
      {
        name: 'swarm-ideas',
        content:
          '# Swarm Ideas\nRoles vs instances vs personas. Reviewer council reuses [[diff-review]]. Resume rides the reconciled terminal rows from [[vision-roadmap]].',
        updatedAt: ago(60 * 49),
      },
    ],
  ],
])

export const BANNER = [
  '\x1b[38;5;208m›\x1b[0m cockpit mock shell — \x1b[2mElectron not detected (browser preview)\x1b[0m',
  '',
]

// --- Command blocks (OSC 133) demo -------------------------------------------
// The browser mock has no real shell, so it scripts a short session framed with
// OSC 133 semantic-prompt marks. This makes the Warp-style command-block
// decorations visible in the localhost screenshot workflow (success, failure,
// and a still-running command) exactly as a real zsh shell would drive them.
export const MOCK_PROMPT = '\x1b[38;5;208m~/baz/serbest\x1b[0m \x1b[38;5;150m❯\x1b[0m '

export interface MockCommand {
  command: string
  lines: string[]
  exitCode: number | null
  /** Simulated run time between output-start (C) and command-end (D). */
  runMs: number
}

export const MOCK_SESSION: MockCommand[] = [
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

// Kanban board seed (Phase 6). Cards for the demo project only — the cockpit
// project starts with an empty board so the empty state is explorable too.
export const kanbanSeed = new Map<string, KanbanCard[]>([
  [
    'prj_serbest',
    [
      {
        id: 'card_hero01',
        projectId: 'prj_serbest',
        title: 'Rewrite hero section copy',
        body: 'Tone: confident, calm. Reference the brand voice note in the memory hub.',
        status: 'todo',
        position: 1024,
        role: null,
        persona: null,
        agent: null,
        assignments: [],
        pipelineStep: 0,
        councilSessionId: null,
        terminalSessionId: null,
        worktreePath: null,
        branch: null,
        createdAt: ago(190),
        updatedAt: ago(190),
      },
      {
        id: 'card_form02',
        projectId: 'prj_serbest',
        title: 'Contact form: server-side validation',
        body: 'Zod schema on the API route; mirror errors under each field.',
        status: 'todo',
        position: 2048,
        role: 'builder',
        persona: null,
        agent: null,
        assignments: [
          { role: 'builder', spec: 'backend' },
          { role: 'reviewer', spec: 'security' },
        ],
        pipelineStep: 0,
        councilSessionId: null,
        terminalSessionId: null,
        worktreePath: null,
        branch: null,
        createdAt: ago(120),
        updatedAt: ago(60),
      },
      {
        id: 'card_seo03',
        projectId: 'prj_serbest',
        title: 'Add structured data for attorney profiles',
        body: 'schema.org/Attorney JSON-LD on each profile page.',
        status: 'in_review',
        position: 1024,
        role: 'builder',
        persona: null,
        agent: null,
        assignments: [{ role: 'builder', spec: 'frontend' }],
        pipelineStep: 0,
        councilSessionId: null,
        terminalSessionId: null,
        worktreePath: '/Users/baz/dev/serbest-law/.swarm/attorney-jsonld-eo03',
        branch: 'swarm/attorney-jsonld-eo03',
        createdAt: ago(300),
        updatedAt: ago(15),
      },
      {
        id: 'card_a11y04',
        projectId: 'prj_serbest',
        title: 'Audit color contrast on dark sections',
        body: '',
        status: 'done',
        position: 1024,
        role: 'reviewer',
        persona: null,
        agent: null,
        assignments: [{ role: 'reviewer', spec: null }],
        pipelineStep: 0,
        councilSessionId: null,
        terminalSessionId: null,
        worktreePath: null,
        branch: null,
        createdAt: ago(1500),
        updatedAt: ago(720),
      },
      {
        id: 'card_x9k2',
        projectId: 'prj_serbest',
        title: 'Contact form: wire intake to CRM webhook',
        body: 'Post validated leads to the CRM endpoint; retry with backoff on 5xx.',
        status: 'in_progress',
        position: 1024,
        role: 'builder',
        persona: null,
        agent: null,
        assignments: [
          { role: 'builder', spec: 'backend' },
          { role: 'reviewer', spec: 'security' },
        ],
        pipelineStep: 0,
        councilSessionId: null,
        terminalSessionId: 'term_mock_1',
        worktreePath: '/Users/baz/dev/serbest-law/.swarm/contact-form-x9k2',
        branch: 'swarm/contact-form-x9k2',
        createdAt: ago(95),
        updatedAt: ago(3),
      },
    ],
  ],
])

// Named Agents roster (browser preview mirror of ~/.claude/agents).
export const namedAgentsMock: NamedAgentSummary[] = [
  { slug: 'apollo', displayName: 'Apollo', tagline: 'Light and form', color: 'ember', role: 'builder', description: 'Frontend builder with a pixel eye.' },
  { slug: 'argos', displayName: 'Argos', tagline: 'A hundred eyes, nothing passes', color: 'signal', role: 'reviewer', description: 'Security reviewer; findings need failure scenarios.' },
  { slug: 'atlas', displayName: 'Atlas', tagline: 'Holds the big picture', color: 'glacier', role: 'planner', description: 'Planner-architect; staged file-level plans.' },
  { slug: 'calliope', displayName: 'Calliope', tagline: 'The client\'s voice, perfected', color: 'ember', role: 'builder', description: 'Copywriter; words that sell.' },
  { slug: 'huginn', displayName: 'Huginn', tagline: 'Flies far, returns with truth', color: 'glacier', role: 'scout', description: 'Scout; returns with one recommendation.' },
  { slug: 'vulcan', displayName: 'Vulcan', tagline: 'The forge never lies', color: 'copper', role: 'builder', description: 'Backend builder; hostile-boundary validation.' },
]
