/**
 * Canonical standing contract for interactive Claude Code and Codex terminals.
 *
 * Keep this text provider-neutral, compact, and shell-safe. It is delivered
 * through provider-native standing channels, never by rewriting user prompts.
 */
import { compileOwnerConstitution } from './owner-constitution'

export const DIRECT_AGENT_CONTRACT_MARK = 'COCKPIT DIRECT AGENT CONTRACT'

export function directAgentContractText(): string {
  return `${DIRECT_AGENT_CONTRACT_MARK} (MUST) — ${compileOwnerConstitution()}`
}
