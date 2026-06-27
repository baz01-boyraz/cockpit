/**
 * Agent router classification (pure, testable).
 *
 * Turns a free-text task into a routing recommendation across the conceptual
 * targets: Claude Code (planning/architecture/deep reasoning), Codex CLI (fast
 * implementation/edits/tests), the local command layer (safe read-only ops),
 * chat (product thinking), and Railway (infra actions). It also flags whether
 * the suggested action is read-only/safe or requires an approval gate.
 *
 * This is heuristic and intentionally transparent — every recommendation
 * carries a rationale the UI can show. It never decides to *run* anything; it
 * only recommends.
 */
import type { AgentType, RouteRecommendation, RouterResult, RouteRisk } from './domain'

interface Signal {
  agent: AgentType
  weight: number
  reason: string
}

const RULES: { test: RegExp; signals: Signal[] }[] = [
  {
    test: /\b(plan|architect|architecture|design|approach|strategy|refactor|understand|explain|review|reason|trade-?off)\b/i,
    signals: [{ agent: 'claude', weight: 3, reason: 'Planning / architecture / deep reasoning suits Claude Code.' }],
  },
  {
    test: /\b(implement|write|build|create|add|edit|fix|generate|scaffold|test|unit test|refactor function)\b/i,
    signals: [{ agent: 'codex', weight: 2, reason: 'Hands-on implementation and file edits suit Codex CLI.' }],
  },
  {
    test: /\b(status|diff|log|search|find|list|lint|typecheck|build|grep|show|what changed)\b/i,
    signals: [{ agent: 'local', weight: 2, reason: 'Read-only inspection can run safely through the local command layer.' }],
  },
  {
    test: /\b(deploy|redeploy|restart|railway|env var|environment variable|service|database|production|rollback)\b/i,
    signals: [{ agent: 'railway', weight: 3, reason: 'Infrastructure / deployment intent routes to the Railway integration.' }],
  },
  {
    test: /\b(why|should i|product|ux|copy|naming|decide|brainstorm|idea|name|pricing)\b/i,
    signals: [{ agent: 'chat', weight: 2, reason: 'Open product/UX thinking is best handled in chat mode.' }],
  },
]

const DANGEROUS = /\b(deploy|redeploy|restart|push|force[- ]?push|delete|drop|reset database|wipe|rm -rf|env var|environment variable)\b/i
const READONLY = /\b(status|diff|log|list|show|search|find|grep|what)\b/i

const SUGGESTED_COMMAND: Partial<Record<AgentType, (q: string) => string | null>> = {
  claude: () => 'claude',
  codex: () => 'codex',
  local: (q) => {
    if (/\bstatus\b/i.test(q)) return 'git status -sb'
    if (/\bdiff\b/i.test(q)) return 'git diff'
    if (/\blint\b/i.test(q)) return 'npm run lint'
    if (/\btypecheck\b/i.test(q)) return 'npm run typecheck'
    if (/\bbuild\b/i.test(q)) return 'npm run build'
    return null
  },
}

const LABEL: Record<AgentType, string> = {
  claude: 'Route to Claude Code',
  codex: 'Route to Codex CLI',
  local: 'Run via local command layer',
  chat: 'Discuss in chat mode',
  railway: 'Handle in Railway integration',
}

function riskFor(agent: AgentType, query: string): { risk: RouteRisk; requiresApproval: boolean } {
  if (agent === 'railway') return { risk: 'dangerous', requiresApproval: true }
  if (DANGEROUS.test(query)) return { risk: 'dangerous', requiresApproval: true }
  if (agent === 'local' && READONLY.test(query)) return { risk: 'safe', requiresApproval: false }
  if (agent === 'chat') return { risk: 'safe', requiresApproval: false }
  return { risk: 'caution', requiresApproval: false }
}

export function classifyRoute(query: string): RouterResult {
  const scores = new Map<AgentType, { weight: number; reasons: string[] }>()

  for (const rule of RULES) {
    if (rule.test.test(query)) {
      for (const s of rule.signals) {
        const cur = scores.get(s.agent) ?? { weight: 0, reasons: [] }
        cur.weight += s.weight
        cur.reasons.push(s.reason)
        scores.set(s.agent, cur)
      }
    }
  }

  // Default to chat when nothing matched.
  if (scores.size === 0) {
    scores.set('chat', { weight: 1, reasons: ['No strong signal detected; chat mode can help scope the task.'] })
  }

  const ranked = [...scores.entries()].sort((a, b) => b[1].weight - a[1].weight)
  const maxWeight = ranked[0][1].weight

  const recs: RouteRecommendation[] = ranked.map(([agent, info]) => {
    const { risk, requiresApproval } = riskFor(agent, query)
    const cmd = SUGGESTED_COMMAND[agent]?.(query) ?? null
    return {
      agent,
      title: LABEL[agent],
      rationale: info.reasons.join(' '),
      confidence: Math.min(0.95, info.weight / (maxWeight + 1) + 0.35),
      risk,
      requiresApproval,
      suggestedCommand: cmd,
    }
  })

  return {
    query,
    primary: recs[0],
    alternatives: recs.slice(1),
  }
}
