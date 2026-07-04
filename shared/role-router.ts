/**
 * Role router (pure, testable) — the "assign an agent for me" engine.
 *
 * Turns a card's free-text title + body into an ORDERED pipeline of role
 * assignments the swarm runs sequentially in one worktree (Planner → Builder
 * → Reviewer…). It is heuristic and transparent by design — every step
 * carries a rationale the card can show — and it never runs anything; the
 * SwarmService decides whether to act on the recommendation.
 *
 * Same lineage as shared/router.ts (weighted regex signals), but its output
 * is a pipeline, not a single route: a task can legitimately need several
 * agents, and their execution order matters.
 */
import {
  ROLES,
  SPECS,
  isSpec,
  type Assignment,
  type Role,
  type Spec,
} from './agent-taxonomy'

/** One assignment plus why the router chose it. */
export interface RoutedAssignment extends Assignment {
  rationale: string
  confidence: number
}

export interface RoleRouteResult {
  pipeline: RoutedAssignment[]
  rationale: string
}

/** Longest reasonable chain — beyond this the board is really several cards. */
const MAX_PIPELINE = 4

/**
 * Canonical execution order. Planning and scouting come first, building/fixing
 * next, testing after, review last — so a detected set always sequences the
 * same sensible way regardless of the order words appeared in the text.
 */
const PIPELINE_ORDER: Record<Role, number> = {
  planner: 0,
  scout: 1,
  builder: 2,
  fixer: 2,
  tester: 3,
  reviewer: 4,
}

interface RoleRule {
  role: Role
  test: RegExp
  weight: number
  reason: string
}

const ROLE_RULES: RoleRule[] = [
  {
    role: 'planner',
    test: /\b(plan|architect|architecture|design|approach|strategy|roadmap|break down|scope)\b/i,
    weight: 3,
    reason: 'Planning / architecture language — a planner drafts the approach first.',
  },
  {
    role: 'builder',
    test: /\b(implement|build|create|add|write|wire|scaffold|feature|develop|integrat|hook up|set up)\b/i,
    weight: 2,
    reason: 'Implementation language — a builder writes the change end-to-end.',
  },
  {
    role: 'fixer',
    test: /\b(fix|bug|broken|failing|fails|crash|error|regression|debug|repair|not working)\b/i,
    weight: 3,
    reason: 'Failure language — a fixer reproduces then applies the smallest fix.',
  },
  {
    role: 'reviewer',
    test: /\b(review|audit|inspect|assess|vet|check over|code review|find issues)\b/i,
    weight: 3,
    reason: 'Review language — a reviewer reads the change set for issues.',
  },
  {
    role: 'tester',
    test: /\b(test|tests|coverage|unit test|e2e|spec|assertion|regression test)\b/i,
    weight: 2,
    reason: 'Testing language — a tester adds the coverage that guards the change.',
  },
  {
    role: 'scout',
    test: /\b(research|investigate|compare|evaluate|explore|which library|options|feasibility|spike)\b/i,
    weight: 3,
    reason: 'Research language — a scout gathers options and recommends one.',
  },
]

interface SpecRule {
  spec: Spec
  test: RegExp
}

/** Domain hints, applied to whichever roles land in the pipeline. */
const SPEC_RULES: SpecRule[] = [
  { spec: 'security', test: /\b(security|secure|inject|injection|xss|csrf|auth|token|secret|leak|sanitiz|vulnerab|redact)\b/i },
  { spec: 'frontend', test: /\b(ui|component|css|button|screen|layout|render|react|style|styling|design system|hero|page|form)\b/i },
  { spec: 'backend', test: /\b(api|endpoint|service|ipc|server|worker|route|handler|queue|webhook|backend)\b/i },
  { spec: 'db', test: /\b(sql|database|migration|query|sqlite|index|table|db)\b/i },
  { spec: 'perf', test: /\b(perf|performance|slow|optimiz|latency|memory leak|bottleneck|re-?render)\b/i },
  { spec: 'types', test: /\b(type|types|typescript|generic|nullab|zod|contract drift)\b/i },
]

/** Reviewers default to the security lens when no domain is stated. */
const DEFAULT_SPEC_FOR: Partial<Record<Role, Spec>> = {}

/** First spec whose pattern hits the text, or null. */
function detectSpec(text: string): Spec | null {
  for (const rule of SPEC_RULES) {
    if (rule.test.test(text)) return rule.spec
  }
  return null
}

/**
 * Which spec a given role should carry: an explicit domain hint always wins;
 * otherwise a role-specific default (if any); otherwise none.
 */
function specForRole(role: Role, detected: Spec | null): Spec | null {
  if (detected && isSpec(detected)) return detected
  return DEFAULT_SPEC_FOR[role] ?? null
}

export function classifyRoles(title: string, body = ''): RoleRouteResult {
  const text = `${title}\n${body}`.trim()

  const hits = new Map<Role, { weight: number; reason: string }>()
  for (const rule of ROLE_RULES) {
    if (!rule.test.test(text)) continue
    const cur = hits.get(rule.role)
    if (!cur || rule.weight > cur.weight) {
      hits.set(rule.role, { weight: rule.weight, reason: rule.reason })
    }
  }

  // Nothing matched → the board's default action is "get it done".
  if (hits.size === 0) {
    hits.set('builder', {
      weight: 1,
      reason: 'No strong signal — defaulting to a builder to carry the card.',
    })
  }

  const detected = detectSpec(text)
  const maxWeight = Math.max(...[...hits.values()].map((h) => h.weight))

  const pipeline: RoutedAssignment[] = [...hits.entries()]
    .sort((a, b) => {
      const order = PIPELINE_ORDER[a[0]] - PIPELINE_ORDER[b[0]]
      return order !== 0 ? order : b[1].weight - a[1].weight
    })
    .slice(0, MAX_PIPELINE)
    .map(([role, info]) => {
      const spec = specForRole(role, detected)
      return {
        role,
        spec,
        rationale: spec
          ? `${info.reason} ${SPECS[spec].label} domain detected.`
          : info.reason,
        confidence: Math.min(0.95, info.weight / (maxWeight + 1) + 0.35),
      }
    })

  const labels = pipeline.map((s) => ROLES[s.role].label)
  const rationale =
    pipeline.length > 1
      ? `Auto-assigned a ${labels.join(' → ')} pipeline from the card text.`
      : `Auto-assigned a ${labels[0]} from the card text.`

  return { pipeline, rationale }
}
