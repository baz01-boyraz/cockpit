# BridgeSpace-inspired Roadmap for cockpiT

> Research date: 2026-07-01. Source of inspiration: **BridgeSpace 3** by BridgeMind
> (Matthew Miller, "vibe coding to $1M" — built live on YouTube).
> This doc is the running to-do for porting BridgeSpace's best ideas into cockpiT
> and making our future projects feel next-level / futuristic. We build these
> **in sequence**, one at a time. Keep it in the back of our minds.

## Guiding principle we're borrowing

> **"A workroom, not another tab."** Don't hide complexity — keep the moving parts
> visible enough that you can steer them. The human stays in the loop.

cockpiT is **not** a BridgeSpace clone. We already have terminals, GitPanel,
ProjectService, RailwayService, LogIntelligence, UsageService, redaction, approval,
audit, and a memory architecture in progress. This roadmap only ports the pieces
BridgeSpace has that we **don't** yet — the futuristic delta — while respecting our
non-negotiables (secure-by-default Electron, narrow preload bridge, `shared/` runtime-
dependency-free, mock bridge parity, no Monaco).

---

## Build sequence (agreed)

1. **Command Blocks** ✅ COMPLETE (all phases) — awaiting live packaged-shell check
2. **Pre-ship AI Diff Review** ← NEXT
3. **Memory Graph + Wikilinks**
4. **Multi-agent Swarm + Kanban**
5. → then pivot to real, revenue-generating projects using this foundation.

---

## 1. Command Blocks  ·  status: ✅ COMPLETE (all phases) · awaiting live packaged-shell check

> **All phases implemented 2026-07-01** (renderer + mock verified via localhost
> screenshots). 171 unit tests green, typecheck + lint clean.
>
> **Phase 1 — plumbing + inline decorations (shipped earlier):** pure OSC 133 parser
> in `shared/command-blocks.ts`, zsh shell-integration injection, renderer gutter/ruler
> decorations (`src/lib/commandBlocks.ts` + `TerminalView`), mock synthetic blocks, CSS.
> **Completed here:** command navigation controls (prev/next command, jump-to-latest)
> driven by xterm command markers, in the terminal toolbar.
>
> **Phase 2 — foldable Blocks view (this build):** a per-pane **Stream ↔ Blocks** toggle
> in the terminal toolbar. Blocks renders captured command history as true foldable DOM
> cards — command text, exit-status pill (green/red/ember), duration + relative timestamp,
> collapsible ANSI-coloured output, copy, and re-run. Backed by a pure, resumable capture
> model (`CommandStreamSplitter` + `CommandBlockModel`) and a dependency-free ANSI→HTML
> renderer (`shared/ansi-to-html.ts`), both fully unit-tested. Works in the browser mock
> (mock now scripts a staged OSC-133 session with realistic durations).
>
> **Phase 3 — integration + polish (this build):** full-screen TUI suppression — while
> Claude/vim/a pager repaints (alt-screen), block-output capture pauses (reusing
> `log-sanitize`'s alt-screen signal) so one app can't bloat a single block; output and
> retained-block counts are bounded. **bash** shell integration added via `--rcfile`
> (DEBUG-trap scheme, bash-3.2 compatible — macOS-safe), unit-tested.
>
> **Still to verify live** (couldn't be E2E-tested in the dev env — needs a packaged pty
> via `npm run app:refresh`): real zsh + bash OSC 133 injection end-to-end.
> **Deliberately deferred** (need live-shell validation before shipping): fish / pwsh
> injection (currently a graceful no-op → plain scrollback), LogIntelligence-insight →
> block attachment, and the per-block "review with AI" action (bridges into Feature #2).

**What it is:** Warp-style terminal. Each shell command is captured as a discrete,
foldable **block** containing: the command text, its full output, an **exit-code
indicator** (green = success / red = failure), and a **timestamp**. Scroll back and
find a specific command's result instantly instead of scanning a wall of text.

**What it is NOT:**
- Not a new terminal engine — it sits on top of our existing `TerminalManager` (node-pty).
- Not a REPL or notebook — real shell, real processes.
- Not required to parse every shell; graceful fallback to plain scrollback when we
  can't detect command boundaries.

**cockpiT fit:** High. Most visible "instant modern" win. Natural synergy with
LogIntelligence (a block is a clean unit to attach insights/errors to). The hard part
is **command-boundary detection** (shell integration via OSC 133 semantic prompt
markers, or prompt heuristics) — decide approach in the plan phase.

---

## 2. Pre-ship AI Diff Review  ·  status: TODO

**What it is:** From the Git panel, package the working-tree + staged + untracked
changes into a **read-only** prompt and send it to an AI agent for a focused
bug / regression / security pass **before** you commit or push.

**What it is NOT:**
- Not an auto-committer or auto-fixer — read-only advisory; human decides.
- Not a secret leak: **redact secret-like values, block sensitive paths** (`.env`,
  credentials, private keys), and treat **every diff line as untrusted input**
  (prompt-injection resistant). This is a hard requirement.

**cockpiT fit:** Very high. We already have `GitPanel`, `shared/redaction.ts`,
`ApprovalService`, `AuditLogService`. This is mostly wiring existing parts + one new
review surface. Fits our security-first identity perfectly.

---

## 3. Memory Graph + Wikilinks  ·  status: TODO

**What it is:** Local-first **markdown** knowledge hub that lives next to the repo
(BridgeSpace uses `.bridgememory/`). Notes connect via `[[wikilinks]]`, with
**backlinks** and a **force-directed graph view**. Every agent reads/writes the same
hub, so context compounds across sessions ("today's bug already has a note from three
weeks ago"). BridgeSpace exposes it to agents via ~12 MCP tools: `create_memory`,
`search_memories`, `find_backlinks`, `suggest_connections`.

**What it is NOT:**
- Not a cloud DB — plain markdown files you own, commit, version, back up.
- Not a replacement for our SQLite session layer — this is the *knowledge* layer
  (see our existing memory architecture direction / Obsidian capture).

**cockpiT fit:** Very high, long-term differentiator. Our memory architecture is
already heading this way; `[[wikilink]]` + backlink + graph view is the "next-level"
upgrade. Ties into the existing Notepad/knowledge-capture work.

---

## 4. Multi-agent Swarm + Kanban  ·  status: TODO / biggest

**What it is:** Up to **16 parallel AI agents** in builder / reviewer / scout roles.
A **Kanban board** (Todo → In Progress → In Review → Complete) drives agent
execution: pick a task → open/assign a workspace → build a context-aware command →
send to a terminal → monitor. Plus **crash/quit resume** (an agent alive at exit is
offered for resume into its original terminal on next launch), and account/usage-limit
awareness.

**What it is NOT:**
- Not one-shot — designed for the daily loop, not a demo.
- Not "hide the agents" — keep status live and visible; human reviews before ship.
- Not built in one pass — phase it: single-agent-from-Kanban first, then parallelism,
  then resume/recovery, then role specialization (builder/reviewer/scout).

**cockpiT fit:** Most ambitious, highest "wow". Aligns with our existing AI agent
router. Largest effort — save for last before we monetize.

### Design notes captured 2026-07-01 (revisit at build time)

**Roles vs. instances vs. personas — three distinct layers.**
- **Role (function):** what an agent *does* — builder / reviewer / scout / planner.
  You author a small, fixed set of these once.
- **Instance (worker):** a runtime *copy* of a role, spawned per Kanban card, with its
  own context + terminal + task, killed when done. Not a fixed identity — 3 active
  builder cards = 3 builder instances cloned from one template. Instance count is
  variable; the role set is stable. (Same shape as Claude Code's agent-type → N spawns,
  and our `isolation: worktree` for parallel edits.)
- **Persona (character/lens):** the *voice and values* layered into a role's system
  prompt — e.g. reviewer as "paranoid security veteran" vs "pragmatic ship-it senior"
  vs "type-safety zealot". Same role, different lens. Highest payoff on the review /
  council pattern: N personas on the *same* diff each catch a different class of bug —
  diversity beats redundancy. An agent definition = role + persona + model + tool
  allow-list, all in one system prompt. Ship a few defaults; let the user author custom
  personas (the `.claude/agents/` model).

**Two parallelism models (don't conflate them):**
- **A — parallel tasks (the real "swarm"):** N Kanban cards → N instances, each on a
  *different* task, running at once (worktree-isolated to avoid clobbering).
- **B — multiple roles on one task:** builder writes → reviewer critiques → scout
  researches. Collaboration on a single card, not everyone typing the same file.

**Orchestrator question — who is the conductor? There is always one; the planner is
never self-driving.** Two candidate architectures:
- **A — a main-loop Claude is the orchestrator** (how Claude Code works today): user
  gives a task → the main agent calls a *planner as a tool* → planner returns a plan →
  the main agent spawns builders and routes their output (which returns to the
  orchestrator, not the user). Flexible, steerable by conversation, but bound to one
  live session.
- **B — cockpiT's own orchestrator service is the conductor** (a TS service, not a
  Claude): user task → service creates Kanban cards → invokes a planner *worker* to
  decompose → spawns each card as a `claude` process into its own terminal → owns
  worktree isolation, monitoring, crash/quit resume, and usage-limit account switching.
  A chat session can't durably hold Kanban state + resume; those belong in a service.
- **Leaning:** roadmap's demands (persistence, resume, board-driven) point at **B**, but
  the pragmatic build is likely **hybrid** — the service owns board/lifecycle/resume, a
  planner-Claude does the decomposition. Decide firmly at build time.

---

## Also seen in BridgeSpace (parking lot — evaluate later, not scheduled)

- **Workspace layout templates** (1/2/4/6/8/10/12/14/16-pane presets) + color-coded tabs.
- **"Rooms"** as an information-architecture concept: Command Room (shells),
  Swarm Room (agents), Review Room (ship decision).
- **Detachable panels** — float editor / git / browser / memory into separate OS
  windows (Electron `BrowserWindow`), synced with the active workspace.
- **Voice widget + global push-to-talk** (BridgeVoice-style, on-device Whisper).
- **25+ themes** (Void, Neon Tokyo, Synthwave, Dracula, …) — we have our own ember/
  copper token system; only relevant if we ever ship a theme picker.
- **What's-new card** on first launch after update (we already ship real releases).
- **SSH profiles** with default dir + startup command + one-click duplicate.
- **Multi-account switching** with usage-limit-triggered account swap offers.

## Ecosystem context (for reference)

BridgeMind = 5 products: **BridgeSpace** (workspace), **BridgeMemory** (graph),
**BridgeMCP** (MCP server), **BridgeVoice** (voice-to-code), **BridgeAgent**
(self-improving agent). Tauri/Rust stack, macOS/Windows/Linux, GPU-accelerated
terminal. Basic $16–20/mo includes BridgeSpace; Pro adds Memory/MCP/Voice.
