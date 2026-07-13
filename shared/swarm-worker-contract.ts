/** Contract delivered only to a worker launched from an explicit Swarm card. */
export const SWARM_WORKER_CONTRACT_MARK = 'COCKPIT SWARM WORKER CONTRACT'

export function swarmWorkerContractText(): string {
  return (
    `${SWARM_WORKER_CONTRACT_MARK} (MUST) — You were launched for exactly one explicit ` +
    'card in its assigned worktree. Implement only that card; do not create or start other ' +
    'cards, delegate the task, or expand scope. Verification does not authorize app refresh, ' +
    'quit, restart, installation, commit, push, or release. Stop with the worktree ready for review.'
  )
}
