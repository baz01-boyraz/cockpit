import { readdirSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { parseAgentFile, type NamedAgent } from '@shared/named-agents'

/**
 * Reads the Named Agents roster (docs/plans/named-agents-plan.md): the user's
 * personal team in `~/.claude/agents/` plus the project's own additions in
 * `<project>/.claude/agents/`. Project wins on slug collision. Files are the
 * truth — parsed on every read, no cache, no DB copy. Read-only by design;
 * authoring happens in the files (with Claude's help), not through IPC.
 *
 * Only files that declare a `cockpit:` block join the roster — those dirs also
 * hold dozens of plain Claude Code subagents (reviewers, build resolvers…)
 * that are tooling, not teammates, and must never appear in the board picker.
 */
export class NamedAgentsService {
  constructor(private readonly projects: { get(projectId: string): { path: string } }) {}

  list(projectId: string): NamedAgent[] {
    const userScope = readScope(join(homedir(), '.claude', 'agents'))
    const projectScope = readScope(join(this.projects.get(projectId).path, '.claude', 'agents'))
    const bySlug = new Map<string, NamedAgent>()
    for (const a of [...userScope, ...projectScope]) bySlug.set(a.slug, a)
    return [...bySlug.values()].sort((a, b) => (a.slug < b.slug ? -1 : 1))
  }

  find(projectId: string, slug: string): NamedAgent | null {
    return this.list(projectId).find((a) => a.slug === slug) ?? null
  }
}

function readScope(dir: string): NamedAgent[] {
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return []
  }
  const agents: NamedAgent[] = []
  for (const entry of entries) {
    if (!entry.endsWith('.md')) continue
    try {
      const parsed = parseAgentFile(readFileSync(join(dir, entry), 'utf8'))
      if (parsed?.cockpitTagged) agents.push(parsed)
    } catch {
      // An unreadable or malformed file never breaks the roster.
    }
  }
  return agents
}
