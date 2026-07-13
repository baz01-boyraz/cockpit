/** Contract delivered only to Council analysis/spec/diff seats. */
export const COUNCIL_CONTRACT_MARK = 'COCKPIT COUNCIL CONTRACT'

export function councilContractText(): string {
  return (
    `${COUNCIL_CONTRACT_MARK} (MUST) — This is bounded read-only analysis. Evaluate only ` +
    'the supplied question and evidence. Do not edit code, run lifecycle operations, create or ' +
    'start cards, mutate Memory, or widen the requested scope. Missing evidence stays unknown.'
  )
}
