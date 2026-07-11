---
schema: 1
name: worktree-resume-transcript
title: Worktree-based parallel agents survive session-limit kill via transcript resume
class: gotcha
capturedAt: 2026-07-09T08:40:42.890Z
gate: asked
updatedAt: 2026-07-09T08:40:42.890Z
---

All 5 Wave 3 agents (G1, G3, E4, A4+A6, F1+F2) were killed mid-execution by Claude Code session-limit. On resume, each agent was re-created with its saved transcript as context and each picked up exactly where it was cut off. Zero work lost: G3 finished its sentinel outcome backend+IPC, G1 completed swarm outcome events, E4 built council standalone surface, A4+A6 finished zombie audit + council marker. The pattern: the orchestrator (not the swarm system itself) saved each subagent's full transcript before the kill, then embedded it as context in new subagent invocations. This is a Hermes-level resilience capability, not a worktree property.

Related: [[swarm-design]], [[multiagent-isolated-worktree]], [[sentinel-backbone-first-sequencing]]
