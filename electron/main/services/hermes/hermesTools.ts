import {
  subscribeCardOutputSchema,
  swarmCompletionReportSchema,
  swarmCreateCardSchema,
  swarmProjectSchema,
  swarmStartCardSchema,
  swarmUpdateCardSchema,
  usageQuotaSchema,
} from '@shared/schemas'
import { formatCompletionSummary, type CompletionReport } from '@shared/completion-report'
import type { BoardColumn, KanbanCard } from '@shared/kanban'
import type { HermesTool, HermesToolContext } from './hermesToolTypes'
import { createGitTools } from './hermesToolsGit'
import { createChecksTools } from './hermesToolsChecks'
import { createMemoryTools } from './hermesToolsMemory'
import { createLogTools } from './hermesToolsLogs'
import { createProposeTools } from './hermesToolsPropose'
import { createCouncilTools } from './hermesToolsCouncil'

// Re-exported so existing importers (and the tests) keep a single entry point.
export type { HermesTool, HermesToolContext } from './hermesToolTypes'

function findCard(board: readonly BoardColumn[], cardId: string): KanbanCard | null {
  for (const column of board) {
    const card = column.cards.find((c) => c.id === cardId)
    if (card) return card
  }
  return null
}

/** Compact, model-readable rendering of a completion report: the summary
 *  one-liner, the branch, and the acceptance-criteria checklist. */
function formatCompletionReportText(report: CompletionReport): string {
  const lines = [formatCompletionSummary(report), `Branch: ${report.branch ?? 'none'}`]
  if (report.acceptance.length > 0) {
    lines.push('Acceptance criteria:')
    for (const item of report.acceptance) lines.push(`- ${item}`)
  } else {
    lines.push('Acceptance criteria: none listed in the card body')
  }
  return lines.join('\n')
}

/**
 * Build the full Hermes tool set: the six Faz 3a swarm/usage tools defined here,
 * plus the Faz 3b git / checks / screenshot / memory groups and the Faz 6
 * log-intelligence + propose-card groups. This list is exhaustive by design —
 * Hermes' MCP capability is EXACTLY these tools, every one re-validating its
 * input with the same schema its IPC counterpart uses. No raw shell, no
 * filesystem, no capability beyond what is registered here. Note that
 * `propose_swarm_card` can only REQUEST an approval — opening a card from a
 * self-initiated proposal is the HermesApprovalExecutor's job, post human-approval.
 */
export function createHermesTools(ctx: HermesToolContext): HermesTool[] {
  return [
    ...createSwarmTools(ctx),
    ...createCouncilTools(ctx),
    ...createGitTools(ctx),
    ...createChecksTools(ctx),
    ...createMemoryTools(ctx),
    ...createLogTools(ctx),
    ...createProposeTools(ctx),
  ]
}

/** The Faz 3a swarm + usage tools (kept inline; the newer groups live in sibling files). */
function createSwarmTools(ctx: HermesToolContext): HermesTool[] {
  return [
    {
      name: 'create_swarm_card',
      description:
        'Create a new Swarm Kanban card (lands in "To do") for a project — the same validated path as the UI "new card" action. title ≤ 200 chars, body ≤ 20,000 chars. Returns the updated board. For non-trivial work, gate the spec first with `council_refine_spec` and pass its approved `sessionId` as `councilSessionId` here — the returned refined spec becomes the card body. Trivial/deterministic tasks may skip the gate (councilSessionId is optional).',
      inputShape: swarmCreateCardSchema.shape,
      run: async (raw) => ({ board: ctx.swarm.createCard(swarmCreateCardSchema.parse(raw)) }),
    },
    {
      name: 'update_swarm_card',
      description:
        'Update a Swarm card: title/body and its role pipeline (`assignments`, an ordered list of {role, spec} capped at 6 steps, validated against the agent taxonomy). Same path as editing a card in the UI. Returns the updated board. Pass `councilSessionId` to link (or clear, with null) the card\'s approved `council_refine_spec` session.',
      inputShape: swarmUpdateCardSchema.shape,
      run: async (raw) => ({ board: ctx.swarm.updateCard(swarmUpdateCardSchema.parse(raw)) }),
    },
    {
      name: 'start_swarm_card',
      description:
        'Start a "To do" or "Parked" card: spawns its worker(s) in an isolated git worktree and moves the card to "In progress" — exactly what the UI Start button does. Subject to the concurrency cap, the Claude quota gate, and the council spec gate (a card whose spec has not passed `council_refine_spec` returns `{ gated: true }` and does NOT start — gate it first, then link its approved `councilSessionId`). Returns the updated board.',
      inputShape: swarmStartCardSchema.shape,
      run: async (raw) => {
        const input = swarmStartCardSchema.parse(raw)
        const result = await ctx.swarm.startCard(input)
        // The card never moved when gated — return the (unchanged) board plus the
        // flag so the agent knows to convene the council instead of retrying.
        return result.gated
          ? { gated: true, board: ctx.swarm.board(input.projectId) }
          : { board: result.board }
      },
    },
    {
      name: 'get_swarm_status',
      description:
        "Read the project's live Swarm board (all columns and cards). Reading also reconciles any pending done-signals, so this reflects the current running/finished state, not a stale snapshot.",
      inputShape: swarmProjectSchema.shape,
      run: async (raw) => ({ board: ctx.swarm.board(swarmProjectSchema.parse(raw).projectId) }),
    },
    {
      name: 'subscribe_card_output',
      description:
        "Tail a single running card's terminal output. Returns the output produced since your previous call for that card plus an `isDone` flag; call it again on a short interval to keep following. Scoped to that one card's session — it never leaks another card's output. `isDone` becomes true once the worker exits or the card leaves \"In progress\".",
      inputShape: subscribeCardOutputSchema.shape,
      run: async (raw) => {
        const { projectId, cardId } = subscribeCardOutputSchema.parse(raw)
        const card = findCard(ctx.swarm.board(projectId), cardId)
        if (!card) throw new Error(`Card ${cardId} not found in this project.`)

        const sessionId = card.terminalSessionId
        if (!sessionId) {
          // Never started (or already retired its terminal) — nothing to tail.
          return { cardId, sessionId: null, status: card.status, output: '', exitCode: null, isDone: true }
        }

        // Begin buffering from now (idempotent), then hand back the delta.
        ctx.cardOutput.track(sessionId)
        const drained = ctx.cardOutput.drain(sessionId)
        const running = card.status === 'in_progress'
        const isDone = drained.exited || !running
        // Once done and the final tail has been handed over, stop retaining it.
        if (isDone) ctx.cardOutput.untrack(sessionId)

        return {
          cardId,
          sessionId,
          status: card.status,
          output: drained.output,
          exitCode: drained.exitCode,
          isDone,
        }
      },
    },
    {
      name: 'get_completion_report',
      description:
        "Fetch the completion report for a swarm card that has reached \"In review\". When a card lands there, use this to relay a 30-second decision summary to the user: what was built, the diff size (+added −removed across N files), whether acceptance criteria are met (the report lists them from the refined spec — check the actual diff with get_git_diff_stat/review tools if you need to confirm they were satisfied), and whether it was council-spec'd. Then ask the user to approve (drag to Done), request changes, or park it. Returns a compact text report: the summary line, the branch, and the acceptance-criteria list.",
      inputShape: swarmCompletionReportSchema.shape,
      run: async (raw) => {
        const { projectId, cardId } = swarmCompletionReportSchema.parse(raw)
        const report = await ctx.swarm.completionReport(projectId, cardId)
        return { report: formatCompletionReportText(report) }
      },
    },
    {
      name: 'get_usage_quota',
      description:
        "Read Claude and Codex account quota. Returns each provider's usage windows with `usedPercent` (0–100) and reset times — the sanitized shape only, never a token or account id. Check this before dispatching so a card is not started into an exhausted window.",
      inputShape: usageQuotaSchema.shape,
      run: async (raw) => {
        usageQuotaSchema.parse(raw)
        return await ctx.agentUsage.getReport()
      },
    },
  ]
}
