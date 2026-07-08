// Systematic agent taxonomy (supersedes the named/persona identity model).
// A worker is described by WHAT it does (Role) and, optionally, WHICH domain
// it does it in (Spec) — e.g. Builder·Frontend, Reviewer·Security. Formal and
// composable: the router (shared/role-router.ts) picks assignments from this
// catalog, the SwarmService compiles them into the worker's opening prompt.
//
// Pure module — no runtime deps — so it runs identically in the Electron main
// process and the browser mock. IDs are the only values that cross the IPC
// boundary; prompt text always comes from HERE, never from the renderer.

export type Role = 'planner' | 'builder' | 'reviewer' | 'fixer' | 'scout' | 'tester'
export type Spec = 'frontend' | 'backend' | 'security' | 'types' | 'perf' | 'db'

/** One agent's job on a card: a role, and optionally the domain lens for it. */
export interface Assignment {
  role: Role
  spec?: Spec | null
}

interface CatalogEntry {
  label: string
  prompt: string
}

/** Roles are functions, not personalities — this is the whole formal set. */
export const ROLES: Record<Role, CatalogEntry> = {
  planner: {
    label: 'Planner',
    prompt:
      'Your role: PLANNER. Produce a step-by-step, file-level implementation plan with ordered tasks and explicit risks. Do not implement anything.',
  },
  builder: {
    label: 'Builder',
    prompt:
      'Your role: BUILDER. Implement the card end-to-end — focused code in the repo’s existing style — and run the project checks (typecheck, lint, tests) before you finish.',
  },
  reviewer: {
    label: 'Reviewer',
    prompt:
      'Your role: REVIEWER. Do not write feature code. Read the change set and report findings ordered by severity, each with a file:line reference and a concrete failure scenario.',
  },
  fixer: {
    label: 'Fixer',
    prompt:
      'Your role: FIXER. Reproduce the failure first, then apply the smallest correct fix and prove it green with the project checks. No unrelated refactors.',
  },
  scout: {
    label: 'Scout',
    prompt:
      'Your role: SCOUT. Research only — modify no files. Deliver a short brief: findings, options with trade-offs, one recommendation, and where you looked.',
  },
  tester: {
    label: 'Tester',
    prompt:
      'Your role: TESTER. Add or extend the tests that would have caught the gap, following the repo’s framework and conventions. Aim for meaningful coverage, not vanity assertions.',
  },
}

/** Specialisations are domain lenses folded onto a role (formal, not a persona). */
export const SPECS: Record<Spec, CatalogEntry> = {
  frontend: {
    label: 'Frontend',
    prompt:
      'Domain: FRONTEND — React/CSS/design-system. Respect the token system; every interactive element needs hover, focus-visible and active states; animate only transform/opacity.',
  },
  backend: {
    label: 'Backend',
    prompt:
      'Domain: BACKEND — services, IPC/process boundaries, data layer. Validate at every boundary, fail with explicit errors, never leak secrets across the bridge.',
  },
  security: {
    label: 'Security',
    prompt:
      'Domain: SECURITY. Assume every input is hostile; hunt injection, secret leaks, path traversal, missing authorization and unsafe defaults.',
  },
  types: {
    label: 'Types',
    prompt:
      'Domain: TYPE-SAFETY. Hunt any/unknown leaks, unsound casts, nullability holes and contract drift between modules.',
  },
  perf: {
    label: 'Perf',
    prompt:
      'Domain: PERFORMANCE. Watch for render churn, N+1 and unbounded work, wasted re-computation and allocation on hot paths.',
  },
  db: {
    label: 'Database',
    prompt:
      'Domain: DATABASE. Parameterized queries only; watch migration safety, indexing and transaction boundaries.',
  },
}

/** Stable ordering for pickers and tests — the catalog’s canonical sequence. */
export const ROLE_IDS = Object.keys(ROLES) as Role[]
export const SPEC_IDS = Object.keys(SPECS) as Spec[]

export function isRole(value: unknown): value is Role {
  return typeof value === 'string' && value in ROLES
}

export function isSpec(value: unknown): value is Spec {
  return typeof value === 'string' && value in SPECS
}

/** Human label for a card chip: `Builder·Frontend`, or bare `Planner`. */
export function assignmentLabel(a: Assignment): string {
  return a.spec ? `${ROLES[a.role].label}·${SPECS[a.spec].label}` : ROLES[a.role].label
}

/** The prompt paragraph(s) for one assignment: role leads, spec lens follows. */
export function assignmentPrompt(a: Assignment): string {
  const role = ROLES[a.role].prompt
  return a.spec ? `${role}\n${SPECS[a.spec].prompt}` : role
}

/**
 * The same as assignmentPrompt, but announcing the worker’s place in a
 * multi-step pipeline (Planner → Builder → Reviewer running sequentially in
 * one worktree). A single-step pipeline needs no banner.
 */
export function pipelinePrompt(a: Assignment, index: number, total: number): string {
  const body = assignmentPrompt(a)
  if (total <= 1) return body
  return `Step ${index + 1} of ${total} in this card’s pipeline.\n${body}`
}

/**
 * Persona → Spec fold for retired legacy cards. Only the two personas with an
 * honest domain equivalent map; `pragmatic-shipper` (and anything unknown)
 * carries no spec — a pragmatic reviewer is just a reviewer.
 */
const LEGACY_PERSONA_SPEC: Readonly<Record<string, Spec>> = {
  'security-paranoid': 'security',
  'type-zealot': 'types',
}

/**
 * Map a legacy card's free-text role/persona (the retired role/persona identity
 * model, Faz 4) onto a taxonomy Assignment. The four legacy roles — builder,
 * reviewer, scout, planner — are all taxonomy Roles, so they fold directly; the
 * persona folds onto the nearest honest Spec and is otherwise dropped. Returns
 * null when the role is empty or unknown, so an identity-less legacy card falls
 * through to the caller's no-identity behaviour rather than getting a
 * fabricated one.
 */
export function legacyIdentityToAssignment(
  role: string | null | undefined,
  persona: string | null | undefined,
): Assignment | null {
  if (!isRole(role)) return null
  return { role, spec: LEGACY_PERSONA_SPEC[persona ?? ''] ?? null }
}

/**
 * Coerce untrusted input (IPC payloads, a persisted JSON column) into a clean
 * assignment list: non-arrays yield [], malformed entries are dropped, and an
 * unknown spec degrades to no spec rather than failing the whole card.
 */
export function parseAssignments(value: unknown): Assignment[] {
  if (!Array.isArray(value)) return []
  const out: Assignment[] = []
  for (const entry of value) {
    if (!entry || typeof entry !== 'object') continue
    const role = (entry as { role?: unknown }).role
    if (!isRole(role)) continue
    const rawSpec = (entry as { spec?: unknown }).spec
    out.push({ role, spec: isSpec(rawSpec) ? rawSpec : null })
  }
  return out
}
