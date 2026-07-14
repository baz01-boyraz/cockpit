---
schema: 2
name: council-multi-engine-architecture
title: Council is a bounded multi-engine analysis surface
class: architecture
gate: manual
updatedAt: 2026-07-14T04:58:04.224Z
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
- (2026-07-14) Council seats assigned: Contrarian→gpt-5.6-sol, First Principles→deepseek/deepseek-v4-pro, Expansionist→gpt-5.6-luna, Outsider→gpt-5.6-terra, Builder→claude-sonnet-5. Builder falls back to z-ai/glm-5.2 ONLY when Sonnet usage quota is exhausted (not on technical errors). Chairman is Sol, no fallback.
