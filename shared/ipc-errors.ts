/**
 * IPC error shaping (pure, testable).
 *
 * Handler rejections cross the bridge as message strings and are shown to the
 * user verbatim by the panels. Two problems this solves centrally:
 *   1. ZodError.message is a JSON dump of issues — unreadable in a toast.
 *   2. Internal error messages can embed absolute paths under the user's home.
 *
 * Design note: we deliberately keep the promise-rejection contract (panels
 * already `catch` and render `e.message`) instead of introducing a
 * success/data/error envelope — same UX, far smaller blast radius. Revisit if
 * renderers ever need structured error codes.
 */
import { ZodError } from 'zod'

export function formatIpcError(err: unknown, homeDir?: string): string {
  if (err instanceof ZodError) {
    const issues = err.issues.map((i) => i.message)
    const unique = [...new Set(issues)]
    return `Invalid request: ${unique.join('; ')}`
  }
  let message = err instanceof Error ? err.message : String(err)
  if (homeDir && homeDir.length > 1) {
    message = message.split(homeDir).join('~')
  }
  return message
}
