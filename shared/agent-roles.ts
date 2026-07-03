// Roles & personas (VISION 6.5, BRIDGESPACE design notes). A role is what a
// worker DOES; a persona is the lens it judges through. Both compile into the
// worker's opening prompt — authored here, picked on the card, folded in by
// the SwarmService. IDs are the only values that cross the IPC boundary; the
// prompt text always comes from THIS module, never from the renderer.

export type AgentRole = 'builder' | 'reviewer' | 'scout' | 'planner'

export const AGENT_ROLES: Record<AgentRole, { label: string; prompt: string }> = {
  builder: {
    label: 'Builder',
    prompt:
      'Your role: BUILDER. Implement the card end-to-end — write focused code, follow the existing style of the repo, and run the project checks (typecheck, lint, tests) before you finish.',
  },
  reviewer: {
    label: 'Reviewer',
    prompt:
      'Your role: REVIEWER. Do not write feature code. Read the change set and report findings ordered by severity, each with a file and line reference and a concrete failure scenario.',
  },
  scout: {
    label: 'Scout',
    prompt:
      'Your role: SCOUT. Research only — modify no files. Deliver a short brief: findings, options with trade-offs, one recommendation, and where you looked.',
  },
  planner: {
    label: 'Planner',
    prompt:
      'Your role: PLANNER. Produce a step-by-step implementation plan with file-level detail, ordered tasks, and risks. Do not implement anything.',
  },
}

export interface Persona {
  id: string
  label: string
  lens: string
}

/**
 * Persona lenses. The reviewer-council pattern runs the SAME diff through
 * several of these — diversity catches failure modes redundancy cannot.
 */
export const PERSONAS: Persona[] = [
  {
    id: 'security-paranoid',
    label: 'Security veteran',
    lens: 'Persona lens: paranoid security veteran. Assume every input is hostile; hunt injection, secret leaks, path traversal, missing authorization, and unsafe defaults.',
  },
  {
    id: 'pragmatic-shipper',
    label: 'Pragmatic senior',
    lens: 'Persona lens: pragmatic ship-it senior. Bias toward the smallest correct change; call out scope creep, over-engineering, and anything that blocks shipping.',
  },
  {
    id: 'type-zealot',
    label: 'Type-safety zealot',
    lens: 'Persona lens: type-safety zealot. Hunt any/unknown leaks, unsound casts, nullability holes, and contract drift between modules.',
  },
]

/** Council = the same diff through every persona lens. */
export const COUNCIL_PERSONA_IDS = PERSONAS.map((p) => p.id)

export function personaById(id: string | null | undefined): Persona | null {
  return PERSONAS.find((p) => p.id === id) ?? null
}

/** Prompt paragraphs for a card's role/persona; '' when neither is set. */
export function rolePromptFor(role: string | null, persona: string | null): string {
  const parts: string[] = []
  const r = role && role in AGENT_ROLES ? AGENT_ROLES[role as AgentRole] : null
  if (r) parts.push(r.prompt)
  const p = personaById(persona)
  if (p) parts.push(p.lens)
  return parts.join('\n')
}
