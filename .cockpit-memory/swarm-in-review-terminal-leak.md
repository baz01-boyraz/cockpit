---
schema: 2
name: swarm-in-review-terminal-leak
title: In-review Swarm workers can consume terminal capacity
class: gotcha
gate: manual
updatedAt: 2026-07-13T05:54:22.765Z
status: active
authority: code-verified
authorityRef: owner-approved agent-memory-system-v2 migration
scope: project
confidence: high
firstSeenAt: 2026-07-13T05:54:22.765Z
lastVerifiedAt: 2026-07-13T05:54:22.765Z
reviewAfter: 2027-01-09T05:54:22.767Z
tags: runtime, memory-v2
---

Exited session records do not fill terminal capacity because countActiveAgents counts only running Claude or Codex sessions. The actual leak is a worker process deliberately left running when a completed card moves to In review without a reaper. Park and pipeline advance terminate their workers; any In-review transition must receive the same explicit lifecycle treatment.
