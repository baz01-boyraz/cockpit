import type { CockpitEvents } from '../events'
import type { MemoryAutoCapture } from './MemoryAutoCapture'

/**
 * Wire the terminal-close memory-capture trigger (docs/plans/hermes.md Faz 5).
 *
 * When a Claude pane exits, capture its project's most-recent session right away
 * rather than waiting for the idle-poll. ONLY `claude`-role terminals trigger
 * this — a plain shell, dev server, git, or codex pane closing is not a Claude
 * conversation to distill, so it must never spawn a spurious capture. The
 * capture is fire-and-forget: an exit event handler must never block or throw
 * back into the emitter, and the queue is durable so a dropped drain is picked
 * up on the next sweep.
 *
 * Extracted as a standalone function (not an inline listener in Services) so the
 * exact role filter and dispatch are unit-testable against a real event bus.
 */
export function registerMemoryExitCapture(
  events: CockpitEvents,
  autoCapture: Pick<MemoryAutoCapture, 'captureNow'>,
): void {
  events.onTyped('terminal:exit', ({ projectId, role }) => {
    if (role !== 'claude') return
    void autoCapture.captureNow(projectId)
  })
}
