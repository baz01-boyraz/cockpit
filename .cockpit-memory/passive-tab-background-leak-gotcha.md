---
schema: 2
name: passive-tab-background-leak-gotcha
title: Passive tab buttons need an explicit transparent background
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

The shared tab class and global button reset do not guarantee a background, so native macOS buttonface color can leak through inactive tabs. Every tab container must explicitly set background: transparent and reassert active and hover surface colors at the panel level.
