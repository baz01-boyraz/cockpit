---
schema: 2
name: hermes-update-verification
title: Post-update health check: npm test + manual smoke test
class: reference
capturedAt: 2026-07-06T03:19:25.935Z
gate: asked
updatedAt: 2026-07-06T03:19:25.935Z
status: archived
authority: legacy
scope: project
confidence: low
firstSeenAt: 2026-07-06T03:19:25.935Z
reviewAfter: 2026-07-13T05:20:43.982Z
---

After updating Hermes, verify the integration hasn't broken by: (1) running npm test (distiller/chat tests use mocks but exercise the harness), (2) a manual hermes -z '2+2' --oneshot call to confirm the binary resolves and responds. This is a ~5-minute safety check the architecture itself makes possible — decoupled systems can't silently degrade.

Related: [[hermes-cockpit-decoupled-architecture]]
