/**
 * Global Hermes kill-switch.
 *
 * Hermes is intentionally shelved while its replacement architecture is
 * designed. This is a hard runtime boundary, not a UI preference: production
 * code must call {@link assertHermesRuntimeEnabled} immediately before any
 * Hermes process spawn. Keeping the dormant implementation behind one explicit
 * switch makes the suspension reversible without letting an old background
 * path wake the agent accidentally.
 */
export const HERMES_RUNTIME_ENABLED: boolean = false

export const HERMES_PAUSED_MESSAGE =
  'Hermes is paused. Use the Claude or Codex terminal, or convene the Council.'

export function assertHermesRuntimeEnabled(): void {
  if (!HERMES_RUNTIME_ENABLED) throw new Error(HERMES_PAUSED_MESSAGE)
}
