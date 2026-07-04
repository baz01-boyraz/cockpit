# Plan — Named Agents ("ekip"): identity-first agents across cockpiT + Claude Code

> Status: N1 DELIVERED 2026-07-04 — roster finalized (Baz delegated naming: non-Turkish,
> no Hermes), all six definitions written to `~/.claude/agents/` and live for terminal
> Claudes immediately · next: N2 kernel · Created 2026-07-04
> Origin: Baz's ask — "kendi agentlarımız olacak, onlara isim ve kimlik vereceğiz;
> builder/planner gibi fonksiyon değil, KİMLİK." Supersedes the Phase-7-parked
> "user-authorable personas" idea with something better.

## The core idea

Today's swarm catalog describes **functions** (builder = what it does). A Named
Agent is an **identity** (who does it): a name, a character, a voice, defaults
(role, persona lens, model), skill affinities, and an authored system prompt.
You assign a card to **Vega**, not to "builder". Your team follows you across
projects — that's the feeling a revenue studio needs.

## The unification principle (the whole trick)

**One definition file, three consumers.** Agent definitions are stored in
Claude Code's native format — markdown with YAML frontmatter — so the SAME file
powers:

1. **cockpiT cards** — SwarmService folds the agent's identity into the worker prompt.
2. **Terminal Claudes** (Fable etc.) — Claude Code auto-discovers `agents/*.md`
   and offers them as subagent types, no cockpit code involved.
3. **Workers themselves** — a card's worker is a claude session in that repo; it can
   spawn teammates as ITS subagents. Atlas plans, delegates to Vega. Layered teamwork.

This is the single-rule principle applied to identity: authored once, never duplicated.

## Storage decision (D1)

- **User-level first:** `~/.claude/agents/<slug>.md` — the personal team, travels
  across every project. This is where the roster lives.
- **Project-level override/extension:** `<project>/.claude/agents/` — a project can
  add specialists or override a teammate for its domain. Claude Code already merges
  these scopes natively; cockpiT reads both, project wins on slug collision.
- **Files are truth** (memory-hub lesson): no SQLite copy of definitions; parse on
  read. The card row stores only the agent **slug** (V6: `agent` column).

## Definition format (D2)

Claude Code frontmatter + cockpit extension keys (unknown keys are ignored by
Claude Code — verify against the current parser at build time; fallback is a
`cockpit-*` key prefix):

```markdown
---
name: vega
description: Hızlı ve pragmatik frontend builder — küçük temiz değişiklikler, piksel hassasiyeti
model: sonnet
tools: Read, Write, Edit, Bash, Grep, Glob        # Claude Code tool allow-list
cockpit:
  displayName: Vega
  tagline: "Bitiren el"
  color: ember                                     # avatar/chip tint on the board
  role: builder                                    # default function (existing catalog)
  persona: pragmatic-shipper                       # default lens (existing catalog)
---

Sen Vega'sın: <identity + voice + working style + quality bar + rituals...>
```

The markdown body IS the system prompt. cockpiT never invents prompt text — it
composes: **agent body → role/persona defaults (unless the body overrides) →
card title+body → hub pointers → the standing worker rules** (no commit/push,
control-char-stripped, budgeted — the existing `shared/swarm-worker.ts` boundary).

## What every agent prompt must contain (the quality bar)

Authoring checklist — this is where "ince düşünme" pays:

1. **Identity & voice** — who they are, how they speak, what they refuse.
2. **Craft rules** — concrete, checkable habits (commit style, test-first, file caps),
   aligned with our global rules so agents don't fight the repo standards.
3. **Skill affinities** — which installed skills/commands they reach for
   (e.g. Vega → frontend patterns + TDD; Nazar → security-review).
4. **Memory ritual** — REQUIRED: "before starting, read the hub pointers you were
   given; when you finish, write what you learned to `.cockpit-memory/<topic>.md`."
   ← This is how project memory fills itself (Baz's earlier question, answered
   structurally). Workers can write those files today; no new plumbing needed.
5. **Escalation rule** — what to do when blocked (say so and stop; never push through
   destructive ambiguity). Mirrors the approval-gate philosophy.
6. **Definition of done** — role-appropriate (builder: checks green; reviewer:
   findings with file:line + severity; scout: brief with sources; planner: staged plan).

## Roster — FINAL (world mythology; written to `~/.claude/agents/<slug>.md`)

| Name | Myth | Tagline | Role | Persona | Model | Tools boundary |
|---|---|---|---|---|---|---|
| **Atlas** | Greek titan | Holds the big picture | planner | — | opus | read-only (Read/Grep/Glob) — cannot code, by design |
| **Apollo** | Greek god of light/art | Light and form | builder (frontend) | pragmatic-shipper | sonnet | full build set |
| **Vulcan** | Roman forge god | The forge never lies | builder (backend) | type-zealot | sonnet | full build set |
| **Argos** | Hundred-eyed watchman | Nothing passes | reviewer (security) | security-paranoid | sonnet | read + Bash (runs tests, never edits) |
| **Huginn** | Odin's raven, Thought | Flies far, returns with truth | scout | — | sonnet | read + WebSearch/WebFetch (never writes) |
| **Calliope** | Muse of epic poetry | The client's voice, perfected | builder (copy) | — | sonnet | Read/Write/Edit only — words, no shell |

Every definition carries the six mandatory sections (identity & voice, craft
rules, skill affinities, memory ritual, escalation, definition of done) and the
standing rule: **reports to Baz in Turkish**, code/identifiers untouched.
Council upgrade: **Argos + Apollo + Vulcan** on the same diff — named
perspectives instead of anonymous lenses.

## Build phases (after design sign-off)

- **N1 — Roster workshop (with Baz, no code):** finalize names, characters, prompts.
  Each agent's `.md` written and reviewed one by one. This IS the feature.
- **N2 — Kernel (TDD):** `shared/named-agents.ts` — frontmatter parse (no new deps;
  simple key: value subset), slug validation (wikilink lesson: slug-by-construction),
  `composeAgentPrompt(agent, card, hubPointers)`, precedence rules (project > user,
  agent.persona vs card override). Pure; consumed by service AND mock.
- **N3 — cockpiT wiring:** V6 migration (`kanban_cards.agent TEXT`), NamedAgentsService
  (list/read from both scopes; write later), `swarm.agents` IPC leg, card editor:
  single **Agent** select replaces Role+Persona as the primary control (manual
  role/persona stays as "Custom…" fallback), board chip shows agent name+color.
- **N4 — Agents view (light):** roster gallery (read + open definition file);
  in-app authoring editor only if the file-based flow feels rough in practice.
- **N5 — Live gate:** (a) card assigned to Vega → worker opens speaking as Vega and
  performs its memory ritual; (b) `claude` in the same project can spawn `vega` as a
  subagent natively; (c) council-by-names on a real diff.

## Risks & open questions

- **Prompt budget:** identity + role + persona + card + hub pointers stack up —
  cap agent body length (~2–3k chars) and keep hub as pointers (existing rule).
- **Frontmatter compatibility:** verify Claude Code tolerates the `cockpit:` extension
  key in agents frontmatter; fallback to `cockpit-*` flat keys.
- **Name collisions** with built-in subagent types (`general-purpose` etc.) — validate
  slugs against a reserved list.
- **Untrusted repos:** project-level agent files are executable identity — a cloned
  repo could carry a malicious agent definition. Mitigation: cockpiT marks
  project-scope agents visually and (decision) may require one-time user acknowledgment
  per project before folding them into workers.
- **OPEN (Baz):** roster names/composition; user-level vs project-level default for
  HIS team; does Kalem (copy) earn a seat now or after the first landing-page project?
