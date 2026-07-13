#!/usr/bin/env node
import { createHash, randomBytes } from 'node:crypto'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  writeFileSync,
} from 'node:fs'
import { basename, join, resolve } from 'node:path'

const args = process.argv.slice(2)
const valueAfter = (flag) => {
  const index = args.indexOf(flag)
  return index >= 0 ? args[index + 1] : undefined
}
const rootArg = valueAfter('--root') ?? '.cockpit-memory'
const migrationScope = valueAfter('--scope') ?? 'project'
const apply = args.includes('--apply')
const restoreId = valueAfter('--restore')
const hub = resolve(rootArg)
const now = new Date().toISOString()
const reviewAfter = new Date(Date.now() + 90 * 24 * 60 * 60_000).toISOString()

const ARCHIVE_SLUGS = new Set([
  'coding-fallback-order',
  'command-approval-three-layer',
  'redaction-intake-once',
  'self-initiated-card-protocol',
  'mcp-token-chat-only',
  'memory-distiller-cli-only',
  'sentinel-backbone-first-sequencing',
  'signal-council-needs-clarification-on-the-draft-spec',
  'signal-memory-capture-stopped-after-repeated-failures',
  'signal-port-already-in-use',
  'swarm-release-test-2026-07-06',
  'vision-journey',
])
const GLOBAL_ARCHIVE_SLUGS = new Set([
  'baz-autopilot-silent-resolve',
  'cli-default-model-opus-1m',
  'hermes-autopilot-vision',
  'model-routing-preference',
  'redesign-means-layout-change',
])
const VALID_CLASSES = new Set(['decision', 'gotcha', 'user', 'reference', 'architecture'])
const FIELD_ORDER = [
  'schema', 'name', 'title', 'class', 'session', 'capturedAt', 'gate', 'updatedAt',
  'status', 'authority', 'authorityRef', 'scope', 'confidence', 'firstSeenAt',
  'lastVerifiedAt', 'reviewAfter', 'supersedes', 'tags',
]

function fail(message) {
  process.stderr.write(`[memory-v2] ${message}\n`)
  process.exit(1)
}

if (!existsSync(hub)) fail(`Hub does not exist: ${hub}`)
if (migrationScope !== 'project' && migrationScope !== 'global') {
  fail(`Scope must be project or global, received: ${migrationScope}`)
}

function noteFiles(directory) {
  return readdirSync(directory)
    .filter((name) => /^[a-z0-9][a-z0-9-]*\.md$/.test(name))
    .sort()
}

function parse(content) {
  const match = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*\r?\n(?:[ \t]*\r?\n)?/.exec(content)
  if (!match) return null
  const fields = new Map()
  for (const line of match[1].split(/\r?\n/)) {
    if (!line.trim()) continue
    const colon = line.indexOf(':')
    if (colon < 1) return null
    fields.set(line.slice(0, colon).trim(), line.slice(colon + 1).trim())
  }
  return { fields, body: content.slice(match[0].length) }
}

function serialize(fields, body) {
  const seen = new Set()
  const lines = ['---']
  const optionalEmptyFields = new Set([
    'session',
    'capturedAt',
    'authorityRef',
    'lastVerifiedAt',
    'supersedes',
    'tags',
  ])
  const fieldLine = (key, value) => {
    const clean = String(value ?? '').trim()
    return clean ? `${key}: ${clean}` : `${key}:`
  }
  for (const key of FIELD_ORDER) {
    if (!fields.has(key)) continue
    if (optionalEmptyFields.has(key) && !String(fields.get(key) ?? '').trim()) continue
    lines.push(fieldLine(key, fields.get(key)))
    seen.add(key)
  }
  for (const [key, value] of fields) {
    if (seen.has(key)) continue
    if (optionalEmptyFields.has(key) && !String(value ?? '').trim()) continue
    lines.push(fieldLine(key, value))
  }
  lines.push('---', '')
  return `${lines.join('\n')}\n${body.replace(/^\r?\n+/, '')}`
}

function migratedContent(slug, content) {
  const parsed = parse(content)
  const heading = /^#{1,6}\s+(.+)$/m.exec(content)?.[1]?.trim()
  const fields = parsed?.fields ?? new Map([
    ['schema', '2'],
    ['name', slug],
    ['title', heading || slug.replace(/-/g, ' ')],
    ['class', slug.startsWith('signal-') || slug.includes('gotcha') ? 'gotcha' : 'reference'],
    ['gate', 'manual'],
    ['updatedAt', now],
  ])
  const body = parsed?.body ?? content
  if (!fields.get('name')) fields.set('name', slug)
  if (!fields.get('title')) fields.set('title', heading || slug.replace(/-/g, ' '))
  if (!fields.get('gate')) fields.set('gate', 'manual')
  if (!fields.get('updatedAt')) fields.set('updatedAt', now)
  const archived =
    slug.startsWith('hermes-') ||
    ARCHIVE_SLUGS.has(slug) ||
    (migrationScope === 'global' && GLOBAL_ARCHIVE_SLUGS.has(slug))
  fields.set('schema', '2')
  fields.set('name', slug)
  if (!VALID_CLASSES.has(fields.get('class'))) fields.set('class', 'reference')
  fields.set('status', archived ? 'archived' : (fields.get('status') || 'active'))
  fields.set('authority', fields.get('authority') || 'legacy')
  fields.set('scope', migrationScope)
  fields.set('confidence', fields.get('confidence') || 'low')
  fields.set('firstSeenAt', fields.get('firstSeenAt') || fields.get('capturedAt') || fields.get('updatedAt') || now)
  fields.set('reviewAfter', fields.get('reviewAfter') || (archived ? now : reviewAfter))
  fields.set('supersedes', fields.get('supersedes') || '')
  if (!fields.has('tags')) fields.set('tags', '')
  return { content: serialize(fields, body), skipped: false, archived }
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

function v2Note({ name, title, klass, authority, supersedes = [], body }) {
  const fields = new Map([
    ['schema', '2'],
    ['name', name],
    ['title', title],
    ['class', klass],
    ['gate', 'manual'],
    ['updatedAt', now],
    ['status', 'active'],
    ['authority', authority],
    ['authorityRef', 'owner-approved agent-memory-system-v2 migration'],
    ['scope', migrationScope],
    ['confidence', 'high'],
    ['firstSeenAt', now],
    ['lastVerifiedAt', now],
    ['reviewAfter', new Date(Date.now() + 180 * 24 * 60 * 60_000).toISOString()],
    ['supersedes', supersedes.join(', ')],
    ['tags', 'runtime, memory-v2'],
  ])
  return serialize(fields, `${body.trim()}\n`)
}

const projectCanonicalNotes = new Map([
  ['runtime-architecture-no-hermes', v2Note({
    name: 'runtime-architecture-no-hermes',
    title: 'Runtime architecture: Hermes removed',
    klass: 'architecture',
    authority: 'human-directive',
    supersedes: ['hermes-jarvis-plan', 'hermes-cockpit-decoupled-architecture', 'hermes-mcp-architecture', 'coding-fallback-order'],
    body:
      'Hermes has been removed from the active cockpiT architecture. Interactive Claude Code and Codex terminals work directly in the current repository. Swarm is a separate, explicit UI workflow; direct terminal work never requires a Cockpit project id or card dispatch. Critical behavior is enforced by the human-approved runtime contracts, not inferred from Memory.',
  })],
  ['memory-analysis-provider-neutral', v2Note({
    name: 'memory-analysis-provider-neutral',
    title: 'Memory analysis is provider-neutral',
    klass: 'architecture',
    authority: 'code-verified',
    supersedes: ['memory-distiller-cli-only'],
    body:
      'Memory capture reads both Claude Code and Codex native transcripts through one durable provider-aware queue. Bounded distillation and curation use the dedicated low-cost analysis policy through EngineRunner; capture does not depend on an orchestrator persona or inherit coding permissions.',
  })],
  ['chat-ui-interaction-patterns', v2Note({
    name: 'chat-ui-interaction-patterns',
    title: 'Reusable chat UI interaction patterns',
    klass: 'reference',
    authority: 'equivalent-content',
    supersedes: ['hermes-composer-hint-row', 'hermes-copy-hover-reveal', 'hermes-copy-testing-hover-reveal', 'hermes-mouse-select-user-select-none', 'hermes-docked-shell-layout'],
    body:
      'Reusable chat surfaces dock as a shell column instead of covering terminals, keep keyboard hints in a separate persistent row, reveal copy actions on hover/focus with accessible feedback, and explicitly restore user-select:text where the app-wide default disables selection. UI tests should hover before clicking transition-revealed controls.',
  })],
  ['council-multi-engine-architecture', v2Note({
    name: 'council-multi-engine-architecture',
    title: 'Council is a bounded multi-engine analysis surface',
    klass: 'architecture',
    authority: 'code-verified',
    body:
      'Council runs bounded spec or diff analysis through explicit Claude, Codex, and OpenRouter engine adapters. It receives fenced evidence, has no repository write or lifecycle capability, and does not dispatch direct terminal tasks. OpenRouter credentials remain encrypted in the main process and never cross IPC.',
  })],
  ['diff-review', v2Note({
    name: 'diff-review',
    title: 'Diff review sanitizer and Council boundary',
    klass: 'architecture',
    authority: 'code-verified',
    body:
      'The diff sanitizer is the trust boundary: sensitive paths are excluded, text is redacted and visibly budgeted, injection suspects are detected independently of any model, and evidence is fenced as untrusted. Production model judgment belongs to Council. ReviewService retains deterministic diff-stat and injectable sanitizer plumbing but its standalone model runner is disabled.',
  })],
  ['live-notification-requirement', v2Note({
    name: 'live-notification-requirement',
    title: 'Live notifications are tab-independent and actionable',
    klass: 'architecture',
    authority: 'human-directive',
    body:
      'Important bugs, failures, and reportable events must reach Baz regardless of the selected tab through the notification feed, a bottom-right toast, and macOS notification for alert severity. Each notification carries bounded context and one next action. Delivery is driven by deterministic persisted signals; it does not require an ambient orchestrator or chat persona.',
  })],
  ['memory-authority-trust-ladder', v2Note({
    name: 'memory-authority-trust-ladder',
    title: 'Memory authority grows only through measured owner trust',
    klass: 'decision',
    authority: 'human-directive',
    body:
      'Broad Memory cleanup and constitution promotion require explicit owner control. Reversible archive or merge automation may operate only inside the selected trust mode with a ledger and snapshot; conflicts remain human decisions unless a closed evidence-backed resolution path is deliberately invoked. No provider may grant itself broader authority, and recency alone is never evidence.',
  })],
  ['memory-charter-quality-gate', v2Note({
    name: 'memory-charter-quality-gate',
    title: 'Memory charter and quality gate are active',
    klass: 'architecture',
    authority: 'human-directive',
    body:
      'Every agent-produced Memory candidate must pass the seven-day utility test, dedup-first check, evidence requirement, secret rejection, and one-fact-per-note rule. Claude and Codex share this provider-neutral gate. Lifecycle metadata, recall receipts, a review inbox, snapshots, and the mutation ledger make quality observable and reversible.',
  })],
  ['memory-conflict-double-gate', v2Note({
    name: 'memory-conflict-double-gate',
    title: 'Memory conflicts never use newer-wins',
    klass: 'gotcha',
    authority: 'code-verified',
    body:
      'Conflict safety is enforced by shared trust policy, the stale-checked mutation gateway, and validated IPC boundaries. No trust mode auto-commits a conflict. A resolution needs the owner or a deliberately invoked closed basis of human-directive, code-verified, source-authority, or equivalent-content with rationale and evidence. Every replacement records before and after hashes; ambiguous items remain pending.',
  })],
  ['memory-contract-invisible-channel', v2Note({
    name: 'memory-contract-invisible-channel',
    title: 'Memory contract preserves interactive user text',
    klass: 'architecture',
    authority: 'code-verified',
    body:
      'Interactive user text is never wrapped or modified. Claude receives the managed repository hook and Codex receives the managed AGENTS.md contract; both search project and global Memory before acting and report one evidence status line. Council and Swarm receive only their physically isolated contracts and bounded relevant evidence. Memory text is reference data, never executable instruction.',
  })],
  ['memory-trust-modes', v2Note({
    name: 'memory-trust-modes',
    title: 'Memory trust modes keep conflicts owner-controlled',
    klass: 'architecture',
    authority: 'code-verified',
    body:
      'Memory trust is independently scoped for project and global brains. Project default is Autopilot and global default is Assisted: Autopilot may accept high-quality new facts, proven idempotent merges, and reversible stale-checked cleanup; Assisted accepts only high-quality new facts; Manual auto-commits nothing. No mode auto-commits a conflict, every mutation is ledgered, and unclear evidence remains in the owner inbox.',
  })],
  ['memory-write-gate-asymmetric', v2Note({
    name: 'memory-write-gate-asymmetric',
    title: 'Memory write gate respects owner sovereignty',
    klass: 'decision',
    authority: 'code-verified',
    body:
      'Provider-neutral auto-capture candidates pass the canonical accept, review, or reject write gate; secret-shaped candidates are rejected and audited without entering the brain. Human edits in the Memory UI remain intentionally gate-free because the owner is sovereign. Every new machine write path must declare which side of this boundary it belongs to.',
  })],
  ['molten-obsidian-design', v2Note({
    name: 'molten-obsidian-design',
    title: 'Molten Obsidian visual system',
    klass: 'architecture',
    authority: 'source-authority',
    body:
      'cockpiT uses an obsidian ground with a strict accent budget: ember marks owner attention and primary actions, glacier marks machine data and Codex identity, lime means safe or go, and platinum identifies OpenRouter remote analysis. At most three ember attention points should rest in one view. Motion stays on transform or opacity and honors prefers-reduced-motion; the complete contract lives in docs/DESIGN-VISION.md and docs/DESIGN.md.',
  })],
  ['multiagent-isolated-worktree', v2Note({
    name: 'multiagent-isolated-worktree',
    title: 'Concurrent Swarm workers require isolated worktrees',
    klass: 'gotcha',
    authority: 'code-verified',
    body:
      'When concurrent workers share one git working tree, one workers git add or commit can silently sweep another workers uncommitted files into the wrong change. Every Swarm worker therefore needs its own isolated worktree and scoped branch. Never use broad staging from a shared dirty tree; inspect the explicit file set before commit.',
  })],
  ['openrouter-secret-ref-gotcha', v2Note({
    name: 'openrouter-secret-ref-gotcha',
    title: 'OpenRouter secret ref has one canonical name',
    klass: 'gotcha',
    authority: 'code-verified',
    body:
      'Settings, EngineRunner, and usage reporting share the exported canonical secret ref openrouter.api-key. Older installs may still hold the encrypted value under the retired orchestration-era ref; reading it migrates the value to the canonical ref and removes the legacy entry. Never duplicate this ref as an independent string in another service.',
  })],
  ['orphaned-execfile-children-on-quit', v2Note({
    name: 'orphaned-execfile-children-on-quit',
    title: 'EngineRunner children must be tracked through shutdown',
    klass: 'gotcha',
    authority: 'code-verified',
    body:
      'Council and bounded Memory analysis can spawn Claude, Codex, or remote engine calls through EngineRunner. Every local child handle is tracked and EngineRunner.killAll runs before database close, otherwise a timed-out analysis can survive app shutdown and consume resources. Removed chat-orchestrator children are historical and no longer part of this invariant.',
  })],
  ['sentinel-3-layer-architecture', v2Note({
    name: 'sentinel-3-layer-architecture',
    title: 'Sentinel is deterministic and provider-optional',
    klass: 'architecture',
    authority: 'code-verified',
    body:
      'Sentinel persists and deduplicates deterministic signals first, then delivers feed, toast, and macOS notifications according to severity. Optional bounded triage is a structural seam and is never load-bearing; current production wiring uses deterministic fallback. Sentinel cannot create Swarm work or act as an ambient orchestrator.',
  })],
  ['sentinel-notification-tiering', v2Note({
    name: 'sentinel-notification-tiering',
    title: 'Sentinel notifications protect attention by severity',
    klass: 'decision',
    authority: 'human-directive',
    body:
      'Sentinel uses three delivery levels: info stays in the feed, notice adds a bottom-right toast, and alert adds toast plus macOS notification and app badge. Quiet hours and suppression protect attention. The system earns trust by emitting few accurate notifications with bounded evidence and one next action, never by continuously narrating healthy state.',
  })],
  ['shutdown-killall-db-last', v2Note({
    name: 'shutdown-killall-db-last',
    title: 'Shutdown stops engine and terminal children before the database',
    klass: 'gotcha',
    authority: 'code-verified',
    body:
      'Services.shutdown uses an idempotent closing guard, stops EngineRunner children and terminal PTYs, then closes the database. This ordering prevents live subprocesses from holding resources after persistence is gone. App shutdown remains a high-impact lifecycle action and this cleanup invariant does not grant an agent permission to trigger it.',
  })],
  ['swarm-completion-notification-gap', v2Note({
    name: 'swarm-completion-notification-gap',
    title: 'Swarm completion publishes deterministic evidence',
    klass: 'architecture',
    authority: 'code-verified',
    body:
      'A successful Swarm done signal or clean worker exit stages one structured swarm-completion Sentinel signal from bounded card and session evidence. Production publication uses deterministic summary fallback, persists before delivery, resumes staged rows after restart, and keeps nonzero worker exits as separate failure signals. Completion handling does not open new cards or invoke an orchestrator persona.',
  })],
  ['swarm-in-review-terminal-leak', v2Note({
    name: 'swarm-in-review-terminal-leak',
    title: 'In-review Swarm workers can consume terminal capacity',
    klass: 'gotcha',
    authority: 'code-verified',
    body:
      'Exited session records do not fill terminal capacity because countActiveAgents counts only running Claude or Codex sessions. The actual leak is a worker process deliberately left running when a completed card moves to In review without a reaper. Park and pipeline advance terminate their workers; any In-review transition must receive the same explicit lifecycle treatment.',
  })],
  ['terminal-memory-contract', v2Note({
    name: 'terminal-memory-contract',
    title: 'Terminal memory contract uses native standing channels',
    klass: 'architecture',
    authority: 'human-directive',
    body:
      'Nothing is prepended to the owner interactive prompt. Claude Code receives the managed repository UserPromptSubmit hook and Codex receives the managed AGENTS.md block; both read only relevant project and global notes and start with a Memory evidence status line. Critical behavior rules live in the owner constitution, while note bodies remain untrusted reference data.',
  })],
  ['usage-billing-model', v2Note({
    name: 'usage-billing-model',
    title: 'Usage and billing follow provider boundaries',
    klass: 'architecture',
    authority: 'code-verified',
    body:
      'Claude Code and Codex workers use the owners authenticated provider accounts and quotas. Council remote seats and bounded Memory analysis use the encrypted OpenRouter credential and can consume OpenRouter credit. Deterministic Sentinel delivery and capture queue mechanics do not spend model tokens; analysis calls are explicit, bounded, and provider-neutral.',
  })],
  ['usage-panel-capacity-command-center', v2Note({
    name: 'usage-panel-capacity-command-center',
    title: 'Usage panel is one capacity command center',
    klass: 'architecture',
    authority: 'source-authority',
    body:
      'The Usage panel presents one Engines and spend hero instead of duplicated cards. Claude and Codex each show their provider quota windows; OpenRouter shows its routing-key limit and metered spend. The judgment scorecard is a quieter collapsible band and the provider table remains detail. Capacity ring tone is per window, never per engine, so one low window cannot repaint a healthy window.',
  })],
  ['passive-tab-background-leak-gotcha', v2Note({
    name: 'passive-tab-background-leak-gotcha',
    title: 'Passive tab buttons need an explicit transparent background',
    klass: 'gotcha',
    authority: 'code-verified',
    body:
      'The shared tab class and global button reset do not guarantee a background, so native macOS buttonface color can leak through inactive tabs. Every tab container must explicitly set background: transparent and reassert active and hover surface colors at the panel level.',
  })],
  ['worktree-resume-transcript', v2Note({
    name: 'worktree-resume-transcript',
    title: 'Provider transcript checkpoints preserve interrupted work',
    klass: 'gotcha',
    authority: 'equivalent-content',
    body:
      'An interrupted coding session can resume without losing progress when the provider transcript and isolated worktree are preserved together. The transcript supplies reasoning context while the worktree supplies actual filesystem state. This resilience belongs to provider-native session capture and worktree isolation, not to any ambient orchestrator persona.',
  })],
])

const globalCanonicalNotes = new Map([
  ['owner-direct-agent-constitution', v2Note({
    name: 'owner-direct-agent-constitution',
    title: 'Baz direct-agent constitution',
    klass: 'user',
    authority: 'human-directive',
    body:
      'When Baz writes to Claude Code or Codex in a terminal, the agent works directly in the current repository. Swarm is opt-in only when Baz explicitly asks for it in the current message; a direct agent never looks for a Cockpit project id or delegates through cards. Test, build, commit, push, release, deploy, and app lifecycle actions are separate permissions. Blocked actions are never bypassed through alternative commands, and prior high-impact permission never carries to a new task.',
  })],
  ['app-refresh-consent-rule', v2Note({
    name: 'app-refresh-consent-rule',
    title: 'App lifecycle requires current intent and one-time approval',
    klass: 'user',
    authority: 'human-directive',
    body:
      'Baz does not permit app refresh, quit, restart, replacement, or installation under Applications unless the current message explicitly requests that exact lifecycle action and Cockpit supplies a short-lived one-time approval token. Testing, building, screenshots, committing, pushing, or a previous tasks permission never imply lifecycle consent. If policy blocks the action, do not retry it through shell aliases, lower-level process commands, or another agent.',
  })],
  ['baz-prefers-core-system-first-sequencing', v2Note({
    name: 'baz-prefers-core-system-first-sequencing',
    title: 'Baz prefers core integration before auxiliary polish',
    klass: 'user',
    authority: 'human-directive',
    body:
      'Baz prefers the load-bearing path to be built and verified before auxiliary features or polish. Establish contracts, capability boundaries, persistence, and end-to-end behavior first; then improve UX and secondary conveniences without weakening the core.',
  })],
  ['baz-prefers-determine-then-build', v2Note({
    name: 'baz-prefers-determine-then-build',
    title: 'Baz prefers architecture decisions before implementation',
    klass: 'user',
    authority: 'human-directive',
    body:
      'For a new subsystem, Baz wants the behavior, boundaries, data flow, failure modes, and acceptance criteria determined before implementation starts. He values concrete recommendations and stepwise reasoning; once the direction is settled, implementation should continue autonomously through verified phases unless a genuine owner decision is required.',
  })],
  ['baz-prefers-memory-autopilot-with-guardrails', v2Note({
    name: 'baz-prefers-memory-autopilot-with-guardrails',
    title: 'Baz wants low-friction Memory with visible guardrails',
    klass: 'user',
    authority: 'human-directive',
    supersedes: ['baz-autopilot-silent-resolve'],
    body:
      'Baz does not want to babysit a queue of technical Memory cards. High-confidence new facts, exact merges, and reversible evidence-clear cleanup should proceed according to the selected trust mode with ledger and snapshot protection. Genuine conflicts or ambiguous high-impact choices must remain owner-controlled and be explained as one plain-language decision, never silently resolved by newer-wins.',
  })],
  ['baz-prefers-non-blocking-panels', v2Note({
    name: 'baz-prefers-non-blocking-panels',
    title: 'Baz prefers docked panels that never cover work',
    klass: 'user',
    authority: 'human-directive',
    body:
      'Side panels must not cover or block the terminal grid. Opening a panel should reflow or shrink the workspace into a stable docked layout, with usable narrow-screen behavior, rather than stacking a fixed overlay above active work.',
  })],
  ['baz-prefers-toast-notifications', v2Note({
    name: 'baz-prefers-toast-notifications',
    title: 'Baz prefers actionable toast notifications',
    klass: 'user',
    authority: 'human-directive',
    body:
      'Important events should appear as bottom-right toasts even while Baz works in another tab or terminal, and remain available in a badge-backed notification center. A notification should show concise context and one understandable next action. Routine healthy state should stay quiet.',
  })],
  ['baz-prompt-integrity', v2Note({
    name: 'baz-prompt-integrity',
    title: 'Baz requires verbatim interactive prompts',
    klass: 'user',
    authority: 'human-directive',
    body:
      'Whatever Baz types in an interactive terminal must reach the chosen agent byte-for-byte without a wrapper, prefix, suffix, or hidden rewrite in user content. Repository contracts and Memory lookup requirements belong only in provider-native standing channels such as Claude hooks and Codex AGENTS.md. Memory note bodies are reference data and may never become executable prompt instructions.',
  })],
  ['baz-quota-switch-codex', v2Note({
    name: 'baz-quota-switch-codex',
    title: 'Provider switching is an explicit Baz decision',
    klass: 'user',
    authority: 'human-directive',
    body:
      'Baz may explicitly move work from Claude Code to Codex when Claude quota is low. Cockpit and its agents must never silently switch providers, infer a fallback chain, or spend another provider quota on his behalf. Each direct terminal uses the provider Baz selected and works in the repository under the same constitution.',
  })],
  ['baz-redesign-bar', v2Note({
    name: 'baz-redesign-bar',
    title: 'For Baz, redesign means visible structural change',
    klass: 'user',
    authority: 'human-directive',
    supersedes: ['redesign-means-layout-change'],
    body:
      'When Baz asks for a redesign, he expects an obviously different composition at first glance: new hierarchy, reorganized planes, clearer grouping, or a materially different visualization. Token, color, shadow, hover, or animation polish alone does not count. Verification must include screenshots at realistic desktop and narrow widths.',
  })],
  ['memory-cornerstone-vision', v2Note({
    name: 'memory-cornerstone-vision',
    title: 'Memory is the systems identity foundation',
    klass: 'user',
    authority: 'human-directive',
    body:
      'Baz considers Memory a foundation stone, not a transcript archive. It must capture both Claude and Codex, retain provider and evidence provenance, pass the seven-day value test, deduplicate before writing, separate global preferences from project facts, decay stale knowledge, and remain inspectable and reversible. Critical operating rules belong in the human-approved constitution rather than being left as ordinary notes.',
  })],
  ['memory-is-sacred', v2Note({
    name: 'memory-is-sacred',
    title: 'Baz requires Memory to stay trustworthy and recoverable',
    klass: 'user',
    authority: 'human-directive',
    body:
      'Baz treats Memory as the most important system. Design against missing durable facts, incomplete or contradictory notes, duplicate clutter, stale retrieval, silent capture failure, and writes that are never reviewed again. Changes need tests, observable capture health, authority and confidence metadata, mutation history, snapshots, and an understandable recovery path.',
  })],
  ['overnight-autonomous-shift', v2Note({
    name: 'overnight-autonomous-shift',
    title: 'Baz overnight autonomous-shift contract',
    klass: 'user',
    authority: 'human-directive',
    body:
      'When Baz hands over an overnight multi-phase build, complete and verify every safe in-scope phase without asking routine continue questions, then commit but do not push. Never open, refresh, quit, restart, replace, or install the app while he sleeps. Use browser-safe visual verification when available; defer only checks that truly require a live installed-app lifecycle action and report them plainly.',
  })],
])

const canonicalNotes = migrationScope === 'global' ? globalCanonicalNotes : projectCanonicalNotes

function restore(snapshotId) {
  if (!/^[0-9A-Za-z.-]+-[a-f0-9]{8}$/.test(snapshotId) || snapshotId.includes('..')) {
    fail('Invalid snapshot id.')
  }
  const snapshot = join(hub, '.snapshots', snapshotId)
  if (!existsSync(snapshot)) fail(`Snapshot not found: ${snapshotId}`)
  const snapshotFiles = noteFiles(snapshot)
  const wanted = new Set(snapshotFiles)
  const trash = join(hub, '.trash')
  mkdirSync(trash, { recursive: true })
  const stamp = now.replace(/[:.]/g, '-')
  for (const file of noteFiles(hub)) {
    if (!wanted.has(file)) renameSync(join(hub, file), join(trash, `restore-${stamp}-${file}`))
  }
  for (const file of snapshotFiles) copyFileSync(join(snapshot, file), join(hub, file))
  process.stdout.write(`[memory-v2] restored ${snapshotFiles.length} notes from ${snapshotId}\n`)
}

if (restoreId) {
  restore(restoreId)
  process.exit(0)
}

const files = noteFiles(hub)
const changesByFile = new Map()
const queueChange = (file, before, after) => {
  const existing = changesByFile.get(file)
  if (existing) existing.after = after
  else changesByFile.set(file, { file, before, after })
}
let archived = 0
let skipped = 0
const skippedFiles = []
for (const file of files) {
  const slug = basename(file, '.md')
  const before = readFileSync(join(hub, file), 'utf8')
  const result = migratedContent(slug, before)
  if (result.skipped) {
    skipped += 1
    skippedFiles.push(file)
  }
  if (result.archived) archived += 1
  if (result.content !== before) queueChange(file, before, result.content)
}
for (const [slug, content] of canonicalNotes) {
  const file = `${slug}.md`
  const path = join(hub, file)
  const before = existsSync(path) ? readFileSync(path, 'utf8') : null
  const beforeParsed = before ? parse(before) : null
  const desiredParsed = parse(content)
  const equivalent = Boolean(
    beforeParsed && desiredParsed &&
    beforeParsed.fields.get('schema') === '2' &&
    beforeParsed.fields.get('status') === 'active' &&
    beforeParsed.fields.get('authority') === desiredParsed.fields.get('authority') &&
    beforeParsed.body.trim() === desiredParsed.body.trim(),
  )
  if (!equivalent && before !== content) queueChange(file, before, content)
}
const changes = [...changesByFile.values()].filter((change) => change.before !== change.after)

if (!apply) {
  process.stdout.write(
    `[memory-v2] dry-run (${migrationScope}): ${files.length} notes inspected, ${changes.length} writes planned, ${archived} superseded notes archived, ${skipped} malformed/plain notes skipped.\n`,
  )
  if (skippedFiles.length > 0) process.stdout.write(`[memory-v2] skipped: ${skippedFiles.join(', ')}\n`)
  process.exit(0)
}

if (changes.length === 0) {
  process.stdout.write('[memory-v2] already current; no snapshot or writes needed.\n')
  process.exit(0)
}

const snapshotId = `${now.replace(/[:.]/g, '-')}-${randomBytes(4).toString('hex')}`
const snapshot = join(hub, '.snapshots', snapshotId)
mkdirSync(snapshot, { recursive: true })
const manifest = {}
for (const file of files) {
  const content = readFileSync(join(hub, file), 'utf8')
  copyFileSync(join(hub, file), join(snapshot, file))
  manifest[file] = sha256(content)
}
writeFileSync(join(snapshot, 'manifest.json'), `${JSON.stringify({ version: 1, createdAt: now, files: manifest }, null, 2)}\n`)

for (const change of changes) writeFileSync(join(hub, change.file), change.after, 'utf8')

const maintenance = join(hub, '.maintenance')
mkdirSync(maintenance, { recursive: true })
const report = {
  version: 1,
  scope: migrationScope,
  appliedAt: now,
  snapshotId,
  inspected: files.length,
  changed: changes.length,
  archived,
  skipped,
  skippedFiles,
  created: changes.filter((change) => change.before === null).map((change) => change.file),
  restoreCommand: `node scripts/memory/migrate-v2.mjs --root ${rootArg} --scope ${migrationScope} --restore ${snapshotId}`,
}
writeFileSync(join(maintenance, `memory-v2-${snapshotId}.json`), `${JSON.stringify(report, null, 2)}\n`)
process.stdout.write(
  `[memory-v2] applied ${changes.length} ${migrationScope} writes; archived ${archived}; snapshot ${snapshotId}.\n`,
)
