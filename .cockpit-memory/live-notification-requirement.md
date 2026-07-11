---
schema: 1
name: live-notification-requirement
title: Live notification: tab-independent toast + chat handoff
class: architecture
capturedAt: 2026-07-08T04:16:44.694Z
gate: save
updatedAt: 2026-07-08T04:16:44.694Z
---

Baz requires: (1) system-wide live notifications regardless of current tab, (2) bottom-right toast for bugs/errors/reportable events, (3) clicking the toast opens the chat with context loaded, (4) Hermes monitors everything live — 'kuş bile uçmayacak haberi olmadan'. This is a hard requirement, not a proposal. The existing swarm:cardCompleted→toast pattern is the starting point for generalization.

Related: [[swarm-completion-notification-gap]], [[sentinel-3-layer-architecture]]
