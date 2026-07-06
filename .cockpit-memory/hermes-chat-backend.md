---
schema: 1
name: hermes-chat-backend
title: Hermes chat widget backend (Faz 7) — service owns history, oneshot is stateless
class: decision
capturedAt: 2026-07-05T00:00:00.000Z
gate: save
updatedAt: 2026-07-05T00:00:00.000Z
---

Hermes chat widget backend wired in Faz 7 (`docs/plans/hermes.md`). Key invariants:

- **Hermes oneshot (`-z`) is ALWAYS stateless** — no session id, no `--resume`/`--continue`. So `HermesChatService` (`electron/main/services/hermes/HermesChatService.ts`) keeps conversation history ITSELF in an in-memory `Map<projectId, ChatTurn[]>` and re-sends the whole transcript each turn. Do NOT try to use hermes session ids — that path does not exist for oneshot.
- **Chat MUST run WITHOUT `--ignore-rules`** (unlike the memory distiller). `buildHermesArgs(prompt, { ignoreRules: false })` — chat needs `AGENTS.md` + the `cockpit` MCP tools loaded; that is the whole point. `ignoreRules` defaults to `true` in `shared/hermes-run.ts` so the distiller is unchanged.
- **History cap:** last 20 turns AND 40,000 chars, trimmed from the oldest end (`shared/hermes-chat.ts` `capHistory`). Blunt cap, not semantic compression (Hermes's own context-compression is separate).
- **Transcript format:** short preamble ("You are Hermes, continuing an ongoing conversation…") + `User: …` / `Hermes: …` labelled blocks.
- **A failed turn does NOT commit the user message** to history (would desync the transcript). Errors degrade to `{ ok: false, text: '', error }` — never throw across IPC. ENOENT → friendly "Hermes CLI not found" message.
- **Timeout is 5 min** (a turn may fan out into several MCP tool calls), vs 180s for plain chat/distill.
- IPC: `hermesChat.ask(projectId, message)` / `.clear(projectId)`, schemas `hermesChatAskSchema` (message 1-8000) / `hermesChatClearSchema`, reply type `HermesChatReply`.
- Renderer/UI wiring (`HermesWidget.tsx`) is a SEPARATE pass — backend only here.

Related: [[hermes-jarvis-plan]], [[memory-distiller-cli-only]]
