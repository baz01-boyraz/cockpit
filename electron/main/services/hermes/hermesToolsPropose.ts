import { proposeSwarmCardSchema } from '@shared/schemas'
import type { HermesTool, HermesToolContext } from './hermesToolTypes'

/**
 * `propose_swarm_card` (Faz 6) — the "I noticed this on my own" path.
 *
 * Unlike `create_swarm_card`/`start_swarm_card` (the human-asked Faz 4 flow),
 * this tool NEVER opens or starts a card. It only records an approval request
 * that shows up on the human's Dashboard. The card is opened+started later, by
 * the main process (HermesApprovalExecutor), and only if the human approves.
 * Keeping the open/start capability out of this tool entirely is the whole point
 * of the human-asked vs self-initiated distinction — do not add it here.
 */
export function createProposeTools(ctx: HermesToolContext): HermesTool[] {
  return [
    {
      name: 'propose_swarm_card',
      description:
        "Propose (do NOT open) a Swarm card for something you noticed on your own — a recurring error, a risky diff, tech debt. This records an approval request on the human's Dashboard; the card is only opened and started if they approve it. `reason` is a short WHY (shown in the approval). title ≤ 200 chars, body ≤ 20,000 chars, optional `assignments` role pipeline. For non-trivial work, gate the spec with `council_refine_spec` first and pass its approved `sessionId` as `councilSessionId` — it rides through to the card the human's approval opens; the returned refined spec becomes the body. Returns the approval id — tell the human you've PROPOSED it (not started it) and to check their Dashboard. Use `create_swarm_card`/`start_swarm_card` instead only when the human explicitly asked you to build something.",
      inputShape: proposeSwarmCardSchema.shape,
      run: async (raw) => {
        const { projectId, title, body, reason, assignments, councilSessionId } =
          proposeSwarmCardSchema.parse(raw)
        const request = ctx.approvals.request({
          projectId,
          actionType: 'propose_open_swarm_card',
          summary: `${reason} — ${title}`,
          payload: { title, body, assignments, councilSessionId },
        })
        return {
          approvalId: request.id,
          status: request.status,
          summary: request.summary,
          note: 'Proposed for approval — the card opens only after the human approves it on the Dashboard.',
        }
      },
    },
  ]
}
