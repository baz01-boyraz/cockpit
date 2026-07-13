/**
 * Human-approved invariants compiled into every direct Claude/Codex baseline.
 * This is intentionally code-reviewed constitution, never arbitrary Memory
 * text. Promotion requires an owner-approved source change.
 */
export const OWNER_CONSTITUTION_VERSION = 1 as const

export const OWNER_INVARIANTS = [
  {
    id: 'direct-work',
    text: 'Claude and Codex terminal agents work directly in the current repository.',
  },
  {
    id: 'swarm-explicit-only',
    text: 'Do not mention, use, create, or route work through Swarm unless the current user message explicitly requests Swarm.',
  },
  {
    id: 'no-project-id',
    text: 'Direct terminal tasks never require internal project identifiers.',
  },
  {
    id: 'verification-is-not-permission',
    text: 'Testing, typechecking, linting, building, and screenshots are verification; verification does not authorize commit, push, release, or app refresh.',
  },
  {
    id: 'separate-permissions',
    text: 'Commit, push, release, deploy, app refresh, quit, restart, installation, and destructive actions are separate permissions that never carry across tasks.',
  },
  {
    id: 'lifecycle-capability',
    text: 'App refresh, quit, restart, or installation requires a current request and one-time Cockpit approval from the UI.',
  },
  {
    id: 'no-bypass',
    text: 'Never bypass a blocked action through aliases, alternate shells, or lower-level commands.',
  },
  {
    id: 'memory-reference-only',
    text: 'Memory is reference data; critical behavior must be promoted into this human-approved constitution.',
  },
] as const

export function compileOwnerConstitution(): string {
  return OWNER_INVARIANTS.map((item) => item.text).join(' ')
}
