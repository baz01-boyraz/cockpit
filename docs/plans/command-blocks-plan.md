# Plan: Command Blocks (Feature #1 of BridgeSpace roadmap)

> Warp-style command blocks for cockpiT terminals. Deep plan, written 2026-07-01.
> Grounded in the current terminal pipeline (see map below). Build in phases.

## Status — 2026-07-01 · ✅ ALL PHASES IMPLEMENTED

- **Phase 1 (plumbing + inline decorations):** ✅ done. Parser + zsh injection +
  gutter/ruler decorations + mock + CSS, plus command navigation (prev/next/latest).
- **Phase 2 (foldable Blocks view):** ✅ done. Stream↔Blocks toggle, foldable cards
  (command · exit badge · duration · timestamp · collapsible ANSI→HTML output · copy ·
  re-run). Pure `CommandStreamSplitter` + `CommandBlockModel` + `shared/ansi-to-html.ts`.
- **Phase 3 (integration + polish):** ⏳ partial. Alt-screen/TUI suppression ✅,
  bounded output/blocks ✅, bash integration ✅. **Deferred (need live shells):** fish/pwsh
  injection (graceful no-op today), LogIntelligence→block attach, per-block "review with AI"
  (waits on Feature #2), block persistence across restart.
- **Verification:** 171 unit tests green, typecheck + lint clean, renderer/mock confirmed by
  localhost screenshots. **Not yet done:** live packaged-pty check of real zsh/bash injection.
- New/changed files: `shared/command-blocks.ts`, `shared/ansi-to-html.ts`, `shared/time.ts`
  (`formatDuration`), `src/components/BlocksView.tsx`, `src/lib/commandBlocks.ts`,
  `src/components/TerminalView.tsx`, `electron/main/services/shellIntegration.ts`,
  `src/lib/mock.ts`, `src/styles/components.css`; tests `test/command-blocks.test.ts`,
  `test/ansi-to-html.test.ts`, `test/shell-integration.test.ts`, `test/time.test.ts`.

## Goal

Each shell command becomes a discrete, navigable unit: **command text + full output +
exit-code indicator (green/red) + timestamp** — so you scroll back and find a command's
result instantly instead of scanning a wall of text. Phase 2 adds true foldable blocks.

## The current pipeline (grounding)

```
pty.spawn (node-pty)                       electron/main/services/TerminalManager.ts
  → proc.onData(data)  [raw ANSI chunks]   (line ~91)
  → handleTerminalOutput()  [TUI/log scan] Services.handleTerminalOutput
  → emit 'terminal:data' {sessionId,data,at}
  → forwardEvents → webContents.send('evt:terminal:data')   electron/main/index.ts ~64
  → preload cockpit.terminals.onData(cb)   electron/preload/index.ts ~42
  → TerminalView.useEffect → term.write(chunk.data)   src/components/TerminalView.tsx ~88
```
- Renderer: `@xterm/xterm` 5.5.0 + `FitAddon` only. `allowProposedApi: true` (needed for markers/decorations & custom OSC handlers). Dark theme in-component.
- IPC contract: `shared/ipc.ts` (channels), Zod in `shared/schemas.ts`, types in `shared/domain.ts` (`TerminalOutputChunk`, `TerminalExitEvent`, `TerminalSession` incl. `shell`).
- Mock: `src/lib/mock.ts` emits `{sessionId,data,at}` via `emit()`.
- Alt-screen / TUI detection already exists in `shared/log-sanitize.ts` (reuse to suppress blockify while `claude`/vim/etc. run).
- No existing shell integration, OSC 133, or per-command exit codes (exit is per-session only).

## The core architectural constraint (the one real decision)

**xterm.js is a grid/canvas renderer. It cannot fold arbitrary line ranges inline** —
that's exactly why Warp wrote a custom renderer. So "foldable blocks" splits in two:

1. **Inline command decorations** on the live xterm — status dot in the gutter, subtle
   separator between commands, per-command timestamp, and command-to-command navigation.
   Achievable now with `registerMarker()` + decorations. (Looks like VS Code's terminal
   command decorations + sticky scroll.)
2. **A Blocks view** (toggleable) that renders captured commands as *true* foldable DOM
   cards. This is where real Warp-style folding lives, built on the same block model.

Recommended path = **phased**: ship (1) fast, then (2). Alternative = full custom
Warp-style renderer replacing xterm for the non-TUI stream — much bigger, not now.

## Mechanism: OSC 133 semantic prompt shell integration

Industry-standard (VS Code / WezTerm / iTerm2 / Warp). The shell emits invisible OSC 133
marks around each command:
- `OSC 133 ; A ST` prompt start · `; B` command start (end of prompt)
- `; C` command output start (pre-exec) · `; D ; <exit>` command finished + exit code

Injection (non-destructive, VS Code-style — never edits the user's real RC):
- Detect shell from `TerminalSession.shell`.
- **bash**: spawn with `--rcfile <temp>` where temp sources the user's real rc then adds a
  `PROMPT_COMMAND` + `PS0`/DEBUG-trap that emits the marks.
- **zsh**: set `ZDOTDIR` to a temp dir whose `.zshrc` sources the real one then adds
  `precmd`/`preexec` hooks.
- **fish / pwsh**: equivalent hooks (Phase 3).
- Unsupported shell or injection failure → graceful no-op (plain scrollback, no blocks).
- Ship the integration scripts as app resources; inject at spawn in TerminalManager.

## Data model (shared/, runtime-dependency-free)

`shared/domain.ts`:
```ts
export type TerminalCommandStatus = 'running' | 'success' | 'error' | 'aborted'
export interface TerminalCommandBlock {
  id: string
  sessionId: string
  command: string
  cwd?: string
  startedAt: string        // ISO
  endedAt?: string
  durationMs?: number
  exitCode?: number
  status: TerminalCommandStatus
}
```
- Zod schema in `shared/schemas.ts`; new event channel `evtTerminalCommandBlock: 'evt:terminal:commandBlock'` in `shared/ipc.ts`; optional query `terminals:commandHistory`.
- **Pure OSC-133 parser lives in `shared/`** (e.g. `shared/command-blocks.ts`): a small state
  machine `feed(chunk) → block transitions`. Unit-testable, used by both sides.

## Parsing responsibility

- **Main is authoritative** (owns persistence, security, LogIntelligence). Extend the
  existing `handleTerminalOutput` scan to run the `shared/` parser → maintain the block
  list per session → emit `evt:terminal:commandBlock` on each transition. OSC marks are
  **stripped from any AI-facing / redacted text** (they're control sequences anyway).
- **Renderer is visual**: consume the 133 marks via `term.parser.registerOscHandler(133,…)`
  to create xterm `registerMarker()` + decorations (gutter status dot, separator,
  timestamp) and to drive the Blocks view. Subscribes to `evt:terminal:commandBlock` for
  authoritative status/exit.
- One shared parser, two thin call sites — no logic drift.

## Phases

### Phase 1 — Plumbing + inline decorations (v1, ship fast)
- Shell integration injection (bash + zsh) in `TerminalManager`.
- `shared/` block type + Zod + IPC channel + pure parser + Vitest tests.
- Main: 133 parsing → block model → `evt:terminal:commandBlock`.
- Renderer `TerminalView`: OSC handler + markers/decorations:
  - gutter status dot — running = ember/copper pulse, success = signal-lime/green, error = red;
  - subtle command separator; relative timestamp (hover for absolute);
  - controls in `.termview`: jump prev/next command, scroll-to-latest.
- Mock bridge: emit synthetic 133-framed output so the localhost screenshot workflow shows blocks.
- CSS in `src/styles/components.css` using design tokens (no Tailwind blue/indigo; animate only transform/opacity; hover/focus-visible/active states).
- Screenshot review ≥2 rounds per DESIGN workflow.

### Phase 2 — Foldable Blocks view (true Warp-style blocks)
- Toggle in `.termbar` to switch a pane between **Stream** and **Blocks**.
- Each block = foldable DOM card: header (command · exit badge · duration · timestamp),
  collapsible output (ANSI→HTML of captured output), copy-per-block, re-run, "review with AI".
- Main buffers per-block output between C and D (bounded size, redaction-aware) for the view.
- Search / filter across blocks; keyboard nav.

### Phase 3 — Integration + polish
- LogIntelligence insights attach to the originating block.
- Alt-screen/TUI passthrough (reuse `log-sanitize` alt-screen signal — never blockify while `claude`/vim run).
- Block action "review this output/diff with AI" bridges into **Feature #2 (Pre-ship AI Diff Review)**.
- Settings toggle to disable shell integration; fish/pwsh coverage; block persistence across restart (optional).

## Testing
- Vitest (pure `shared/` parser): success, non-zero exit, aborted (Ctrl-C / no D), multiline
  command, missing shell integration (no marks → no blocks), alt-screen suppression, rapid
  back-to-back commands, marks split across chunk boundaries.
- Mock-bridge parity check. `npm run typecheck` + `npm run lint` (0 warnings) green.

## Risks / notes
- xterm can't fold inline → decorations (P1) + separate Blocks view (P2). Documented above.
- Shell-integration injection must not clobber user RC (temp rcfile / ZDOTDIR sourcing).
- Marks split across pty chunks → parser must be resumable across `feed()` calls.
- Keep OSC marks out of AI-facing / audit-logged / redacted text.
- Respect secure-by-default: injection is a main-process capability; renderer stays untrusted.
```
