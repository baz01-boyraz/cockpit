import {
  subscribeCardOutputSchema,
  swarmCreateCardSchema,
  swarmProjectSchema,
  swarmStartCardSchema,
  swarmUpdateCardSchema,
  usageQuotaSchema,
} from '@shared/schemas'
import type { BoardColumn, KanbanCard } from '@shared/kanban'
import type { HermesTool, HermesToolContext } from './hermesToolTypes'
import { createGitTools } from './hermesToolsGit'
import { createChecksTools } from './hermesToolsChecks'
import { createMemoryTools } from './hermesToolsMemory'
import { createLogTools } from './hermesToolsLogs'
import { createProposeTools } from './hermesToolsPropose'

// Re-exported so existing importers (and the tests) keep a single entry point.
export type { HermesTool, HermesToolContext } from './hermesToolTypes'

function findCard(board: readonly BoardColumn[], cardId: string): KanbanCard | null {
  for (const column of board) {
    const card = column.cards.find((c) => c.id === cardId)
    if (card) return card
  }
  return null
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
        'Create a new Swarm Kanban card (lands in "To do") for a project — the same validated path as the UI "new card" action. title ≤ 200 chars, body ≤ 20,000 chars. Returns the updated board.',
      inputShape: swarmCreateCardSchema.shape,
      run: async (raw) => ({ board: ctx.swarm.createCard(swarmCreateCardSchema.parse(raw)) }),
    },
    {
      name: 'update_swarm_card',
      description:
        'Update a Swarm card: title/body and its role pipeline (`assignments`, an ordered list of {role, spec} capped at 6 steps, validated against the agent taxonomy). Same path as editing a card in the UI. Returns the updated board.',
      inputShape: swarmUpdateCardSchema.shape,
      run: async (raw) => ({ board: ctx.swarm.updateCard(swarmUpdateCardSchema.parse(raw)) }),
    },
    {
      name: 'start_swarm_card',
      description:
        'Start a "To do" or "Parked" card: spawns its worker(s) in an isolated git worktree and moves the card to "In progress" — exactly what the UI Start button does. Subject to the concurrency cap and Claude quota gate. Returns the updated board.',
      inputShape: swarmStartCardSchema.shape,
      run: async (raw) => ({ board: await ctx.swarm.startCard(swarmStartCardSchema.parse(raw)) }),
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
