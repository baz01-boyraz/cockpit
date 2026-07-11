---
schema: 1
name: sentinel-structured-import-gate
title: Sentinel avoids import cycle via Pick structural slice
class: decision
capturedAt: 2026-07-08T05:34:06.209Z
gate: save
updatedAt: 2026-07-08T05:34:06.209Z
---

Each sensor (LogIntelligenceService, SwarmService, ApprovalService, CouncilService) receives a `Pick<SentinelService, 'report'>` structural slice instead of importing SentinelService. Sentinel itself imports nothing from any sensor — zero dependency cycle. Sensors are optional collaborators: tests pass undefined=no-op.

Related: [[sentinel-backbone-first-sequencing]]
