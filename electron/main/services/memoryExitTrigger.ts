import type { CockpitEvents } from '../events'
import type { MemoryAutoCapture } from './MemoryAutoCapture'

/**
 * Wire provider-aware terminal-close memory capture.
 *
 * When a Claude or Codex pane exits, capture that providers most-recent session
 * right away rather than waiting for the idle-poll. Plain shell, dev server,
 * and git panes must never spawn a spurious capture. The
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
    if (role !== 'claude' && role !== 'codex') return
    void autoCapture.captureNow(projectId, role)
  })
}
