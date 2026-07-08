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
  roleText = '',
  councilBrief: string | null = null,
): string {
  const lines = [
    `You are a swarm worker in the cockpiT Kanban board, started for one card.`,
    ...(roleText ? [``, roleText] : []),
    ``,
    `CARD: ${card.title}`,
  ]
  if (card.body.trim().length > 0) lines.push(``, card.body)
  // The council brief sits AFTER the card body, BEFORE the hub pointers: the
  // worker reads the task, then the meeting's conclusions, then where to look.
  // It is authored by our own chairman but arrives via model output, so it goes
  // through the same stripPtyControls hygiene as everything else below.
  if (councilBrief && councilBrief.trim().length > 0) lines.push(``, councilBrief.trim())
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

/**
 * The full shell command the pty runs to start the worker. The `; exit`
 * chain is load-bearing: the pty hosts a shell, so without it a finished
 * worker would drop back to a prompt and the session (and therefore the
 * card, which moves on `terminal:exit`) would look Running forever. `exit`
 * with no argument re-uses the last status, so the worker's exit code
 * survives to the card transition.
 */
const MODEL_RE = /^[a-z0-9.-]{1,40}$/

export function buildWorkerCommand(
  card: { title: string; body: string },
  hubNoteNames: readonly string[],
  roleText = '',
  model: string | null = null,
  councilBrief: string | null = null,
): string {
  // The model id reaches a shell line, so it is allowlisted by shape — an
  // agent definition file with a hostile model value gets ignored, not run.
  const flag = model && MODEL_RE.test(model) ? `--model ${model} ` : ''
  return `claude ${flag}${shellQuote(buildWorkerPrompt(card, hubNoteNames, roleText, councilBrief))}; exit`
}
