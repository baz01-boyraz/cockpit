---
schema: 2
name: memory-trust-modes
title: Memory trust modes keep conflicts owner-controlled
class: architecture
gate: manual
updatedAt: 2026-07-14T00:46:31.000Z
status: active
authority: code-verified
authorityRef: owner-approved agent-memory-system-v2 migration
scope: project
confidence: high
firstSeenAt: 2026-07-13T05:53:28.280Z
lastVerifiedAt: 2026-07-14T00:46:31.000Z
reviewAfter: 2027-01-09T05:53:28.281Z
tags: runtime, memory-v2
---

Memory trust is independently scoped for project and global brains. Project default is Autopilot and global default is Assisted: both may accept high-quality new facts and proven idempotent merges; Autopilot may also apply reversible stale-checked cleanup; Manual auto-commits nothing. No mode auto-commits a conflict. Ordinary uncertainty and low-impact collisions fail closed instead of filling the inbox. Only a genuinely ambiguous replacement of an existing protected, high-impact owner/decision/architecture fact asks the owner, and repeated captures coalesce into one pending decision. Every mutation is ledgered.
