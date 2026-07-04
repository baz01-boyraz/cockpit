// Named Agents kernel (docs/plans/named-agents-plan.md). Parses Claude Code's
// native agent format — YAML-ish frontmatter + markdown body — plus our
// `cockpit:` extension keys. One definition file, three consumers: cockpiT
// cards, terminal Claudes, and workers' own subagents. Pure module: used by
// the main service AND the browser mock, never duplicated.

import { rolePromptFor } from './agent-roles'

export interface NamedAgent {
  slug: string
  description: string
  model: string | null
  displayName: string
  tagline: string | null
  color: string | null
  role: string | null
  persona: string | null
  body: string
  /**
   * True when the file declares a `cockpit:` block — the explicit opt-in that
   * makes an agent file a roster teammate. `~/.claude/agents/` also holds
   * dozens of plain Claude Code subagents (reviewers, resolvers…); without
   * this flag they would all flood the board's agent picker.
   */
  cockpitTagged: boolean
}

/** Renderer-facing summary — prompt bodies stay in main. */
export interface NamedAgentSummary {
  slug: string
  displayName: string
  tagline: string | null
  color: string | null
  role: string | null
  description: string
}

/** Slugs Claude Code already owns — a teammate may not shadow them. */
export const RESERVED_AGENT_SLUGS: readonly string[] = [
  'general-purpose',
  'claude',
  'fork',
  'plan',
  'explore',
]

const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,40}$/

/**
 * Minimal tolerant frontmatter reader for the agent-file subset we own:
 * top-level `key: value` lines and one nested block under `cockpit:` with
 * two-space-indented `key: value` lines. Unknown keys are ignored; other
 * nested blocks are skipped opaquely. Not a YAML parser — and deliberately
 * so (no new dependency for five fields).
 */
export function parseAgentFile(content: string): NamedAgent | null {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(content)
  if (!m) return null
  const [, front, rawBody] = m

  const top = new Map<string, string>()
  const cockpit = new Map<string, string>()
  let section: 'top' | 'cockpit' | 'other' = 'top'
  let cockpitTagged = false
  for (const line of front.split('\n')) {
    if (!line.trim()) continue
    const indented = /^\s/.test(line)
    if (!indented) {
      const kv = /^([A-Za-z][\w-]*):\s*(.*)$/.exec(line.trim())
      if (!kv) continue
      const [, key, value] = kv
      if (value === '') {
        section = key === 'cockpit' ? 'cockpit' : 'other'
        if (key === 'cockpit') cockpitTagged = true
      } else {
        section = 'top'
        top.set(key, value.trim())
      }
    } else if (section === 'cockpit') {
      const kv = /^([A-Za-z][\w-]*):\s*(.*)$/.exec(line.trim())
      if (kv) cockpit.set(kv[1], stripQuotes(kv[2].trim()))
    }
  }

  const slug = (top.get('name') ?? '').toLowerCase()
  if (!SLUG_RE.test(slug) || RESERVED_AGENT_SLUGS.includes(slug)) return null

  return {
    slug,
    description: top.get('description') ?? '',
    model: top.get('model') ?? null,
    displayName: cockpit.get('displayName') ?? slug,
    tagline: cockpit.get('tagline') ?? null,
    color: cockpit.get('color') ?? null,
    role: cockpit.get('role') ?? null,
    persona: cockpit.get('persona') ?? null,
    body: rawBody.trim(),
    cockpitTagged,
  }
}

function stripQuotes(s: string): string {
  return /^".*"$/.test(s) || /^'.*'$/.test(s) ? s.slice(1, -1) : s
}

export function toSummary(a: NamedAgent): NamedAgentSummary {
  return {
    slug: a.slug,
    displayName: a.displayName,
    tagline: a.tagline,
    color: a.color,
    role: a.role,
    description: a.description,
  }
}

/**
 * The identity text folded into a worker prompt: the authored body leads
 * (who they are), the role/persona defaults follow (what function they
 * default to). Composed here so the service and any future consumer agree.
 */
export function composeAgentText(agent: NamedAgent): string {
  const roleText = rolePromptFor(agent.role, agent.persona)
  return roleText ? `${agent.body}\n\n${roleText}` : agent.body
}
