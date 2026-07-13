---
schema: 2
name: memory-conflict-double-gate
title: Memory conflicts never use newer-wins
class: gotcha
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

Conflict safety is enforced by shared trust policy, the stale-checked mutation gateway, and validated IPC boundaries. No trust mode auto-commits a conflict. A resolution needs the owner or a deliberately invoked closed basis of human-directive, code-verified, source-authority, or equivalent-content with rationale and evidence. Every replacement records before and after hashes; ambiguous items remain pending.
