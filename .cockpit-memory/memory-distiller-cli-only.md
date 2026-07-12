---
schema: 1
name: memory-distiller-cli-only
title: Memory distiller uses the explicit Hermes mechanical-model route
class: decision
capturedAt: 2026-07-04T20:49:58.279Z
gate: save
updatedAt: 2026-07-12T05:17:51.000Z
---

# Distiller model route

`MemoryDistiller` invokes Hermes oneshot with `--ignore-rules` and the canonical background model `deepseek/deepseek-v4-flash` from `shared/hermes-model-policy.ts`. This is a bounded mechanical call: no orchestrator persona, no MCP tools, and no silent fallback to the main model.

This supersedes the original 2026-07-04 “local Claude CLI only” decision. Claude-based distillation consumed the same quota reserved for coding; Flash through OpenRouter keeps background capture inexpensive without starving Claude Code. Redaction remains upstream in `TranscriptReader.read(..., true)`, before any transcript reaches Hermes/OpenRouter.

The model proposes `save` versus `ask`, but deterministic reconcile and the active trust policy remain authoritative. Conflicts never auto-commit by recency. Terminal exit triggers immediate capture; the 90-second poll with idle threshold remains a fallback for abandoned sessions.

Related: [[memory-hub]], [[hermes-memory-stewardship-roadmap]], [[claude-print-session-leak-loop]]
