---
schema: 2
name: council-multi-engine-architecture
title: Council is a bounded multi-engine analysis surface
class: architecture
gate: manual
updatedAt: 2026-07-13T05:53:28.280Z
status: active
authority: code-verified
authorityRef: owner-approved agent-memory-system-v2 migration
scope: project
confidence: high
firstSeenAt: 2026-07-13T05:53:28.280Z
lastVerifiedAt: 2026-07-13T05:53:28.280Z
reviewAfter: 2027-01-09T05:53:28.281Z
tags: runtime, memory-v2
---

Council runs bounded spec or diff analysis through explicit Claude, Codex, and OpenRouter engine adapters. It receives fenced evidence, has no repository write or lifecycle capability, and does not dispatch direct terminal tasks. OpenRouter credentials remain encrypted in the main process and never cross IPC.
