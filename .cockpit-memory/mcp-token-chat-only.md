---
schema: 1
name: mcp-token-chat-only
title: MCP bearer token is chat-path-only (triage/distiller excluded)
class: decision
capturedAt: 2026-07-09T05:11:04.819Z
gate: save
updatedAt: 2026-07-09T05:11:04.819Z
---

The per-session rotating bearer token (64 hex chars, crypto.randomBytes(32), timingSafeEqual validation, 401 on mismatch) is only injected into HermesChat spawns. Triage and distiller use `--ignore-rules` with a different argv shape (different model via -m, no MCP/persona, homedir() cwd) — they never connect to the loopback MCP server, so they don't need the token. Token flows as COCKPIT_MCP_TOKEN env var, provided via lazy thunk from Services (hermesMcp is created after hermesChat, so token is read at spawn time not construction). Token auto-rotates every app start.

Related: [[ipc-contract]], [[security-enforcement]]
