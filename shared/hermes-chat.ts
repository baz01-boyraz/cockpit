/**
 * Pure conversation-history helpers for the Hermes chat widget backend
 * (docs/plans/hermes.md Faz 7).
 *
 * Hermes's oneshot mode (`-z`) is ALWAYS stateless — it never emits a session
 * id and has no `--resume`/`--continue` path, so there is no Hermes-side
 * multi-turn continuity to lean on. The backend therefore keeps the transcript
 * itself and re-sends it every turn. These helpers are the pure, dependency-free
 * core of that: a simple size cap (NOT real context compression — that is
 * Hermes's own separate concern) and a transcript renderer.
 *
 * Kept in `shared/` so it stays runtime-dependency-free and unit-testable
 * without spawning a `hermes` process.
 */

export type ChatRole = 'user' | 'assistant'

export interface ChatTurn {
  role: ChatRole
  content: string
}

/** Keep at most this many turns; older ones are dropped first. */
export const MAX_HISTORY_TURNS = 20

/** Keep the transcript under this many characters of turn content. */
export const MAX_HISTORY_CHARS = 40_000

/**
 * Trim a conversation from its OLDEST end until it fits both the turn-count and
 * character caps. Immutable — returns a new array. The most recent turn is
 * always kept even if it alone exceeds the char budget (a single message is
 * bounded elsewhere by the 8000-char schema limit). This is a blunt cap to keep
 * the re-sent prompt bounded, not semantic compression.
 */
export function capHistory(
  turns: readonly ChatTurn[],
  maxTurns: number = MAX_HISTORY_TURNS,
  maxChars: number = MAX_HISTORY_CHARS,
): ChatTurn[] {
  let start = 0
  const charsFrom = (from: number): number =>
    turns.slice(from).reduce((sum, turn) => sum + turn.content.length, 0)
  while (
    start < turns.length - 1 &&
    (turns.length - start > maxTurns || charsFrom(start) > maxChars)
  ) {
    start += 1
  }
  return turns.slice(start)
}

const PREAMBLE =
  'You are Hermes, continuing an ongoing conversation with Baz inside the cockpiT app. ' +
  'The transcript so far is below. Reply only with your next message as Hermes, ' +
  'responding to the most recent "User:" line.'

/**
 * Render turns as a labelled transcript prompt for a single `hermes --oneshot`
 * call. Each turn becomes a `User: …` / `Hermes: …` block; the whole thing is
 * prefixed with a short instruction so a stateless oneshot invocation reads it
 * as a continuing conversation rather than a fresh question.
 */
export function buildTranscriptPrompt(turns: readonly ChatTurn[]): string {
  const lines = turns.map(
    (turn) => `${turn.role === 'user' ? 'User' : 'Hermes'}: ${turn.content}`,
  )
  return `${PREAMBLE}\n\n${lines.join('\n\n')}`
}
