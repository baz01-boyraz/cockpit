// Worker launch text (VISION 6.2). The command string is WRITTEN INTO A PTY,
// so this module is a security boundary: everything user-authored (card title,
// body, hub note names) is control-char-stripped and single-quoted before it
// can reach the shell's line editor.

/** Pointers only — the worker reads notes itself; contents are never inlined. */
const HUB_POINTER_CAP = 20

/**
 * Strip C0 control characters (plus DEL). On a pty they act at the line-editor
 * level even inside shell quotes — a lone `\r` submits the line early, `\x03`
 * interrupts, `\x1b` starts an escape sequence. Newlines and tabs survive
 * (safe inside single quotes; the shell treats them as literal text).
 */
function stripPtyControls(s: string): string {
  // eslint-disable-next-line no-control-regex -- matching control chars IS this sanitizer's job
  return s.replace(/\r\n/g, '\n').replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, '')
}

/** Single-quote for POSIX shells: close, escaped quote, reopen. */
export function shellQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`
}

/**
 * The card's opening prompt for a `claude` worker. Kept small by design
 * (the diff-review budget lesson): the hub appears as file pointers the
 * worker may read with its own tools, never as inlined content.
 */
export function buildWorkerPrompt(
  card: { title: string; body: string },
  hubNoteNames: readonly string[],
): string {
  const lines = [
    `You are a swarm worker in the cockpiT Kanban board, started for one card.`,
    ``,
    `CARD: ${card.title}`,
  ]
  if (card.body.trim().length > 0) lines.push(``, card.body)
  if (hubNoteNames.length > 0) {
    const pointers = hubNoteNames
      .slice(0, HUB_POINTER_CAP)
      .map((n) => `.cockpit-memory/${n}.md`)
      .join(', ')
    lines.push(``, `Project knowledge hub (read the relevant ones first): ${pointers}`)
  }
  lines.push(
    ``,
    `Work ONLY on this card. Do not commit and do not push — when the card is done,`,
    `stop and leave the working tree ready for human review.`,
  )
  return stripPtyControls(lines.join('\n'))
}

/** The full shell command the pty runs to start the worker. */
export function buildWorkerCommand(
  card: { title: string; body: string },
  hubNoteNames: readonly string[],
): string {
  return `claude ${shellQuote(buildWorkerPrompt(card, hubNoteNames))}`
}
