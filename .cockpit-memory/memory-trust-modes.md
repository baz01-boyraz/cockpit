---
schema: 2
name: memory-trust-modes
title: Memory trust modes keep conflicts owner-controlled
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

Memory trust is independently scoped for project and global brains. Project default is Autopilot and global default is Assisted: Autopilot may accept high-quality new facts, proven idempotent merges, and reversible stale-checked cleanup; Assisted accepts only high-quality new facts; Manual auto-commits nothing. No mode auto-commits a conflict, every mutation is ledgered, and unclear evidence remains in the owner inbox.
