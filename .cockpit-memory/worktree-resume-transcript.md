---
schema: 2
name: worktree-resume-transcript
title: Provider transcript checkpoints preserve interrupted work
class: gotcha
gate: manual
updatedAt: 2026-07-13T05:54:22.765Z
status: active
authority: equivalent-content
authorityRef: owner-approved agent-memory-system-v2 migration
scope: project
confidence: high
firstSeenAt: 2026-07-13T05:54:22.765Z
lastVerifiedAt: 2026-07-13T05:54:22.765Z
reviewAfter: 2027-01-09T05:54:22.767Z
tags: runtime, memory-v2
---

An interrupted coding session can resume without losing progress when the provider transcript and isolated worktree are preserved together. The transcript supplies reasoning context while the worktree supplies actual filesystem state. This resilience belongs to provider-native session capture and worktree isolation, not to any ambient orchestrator persona.
