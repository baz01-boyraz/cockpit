---
schema: 1
name: sentinel-create-card-provenance
title: Sentinel→card provenance: hidden HTML marker in card body, not schema change
class: architecture
capturedAt: 2026-07-09T09:44:09.154Z
gate: save
updatedAt: 2026-07-09T09:44:09.154Z
---

H1 sentinel:createCard channel embeds signal provenance as `<!-- sentinel-signal: <id> -->` HTML comment in the card body to avoid schema migration. H2 hook in SwarmService.recordCardFate extracts it on shipment via extractSignalRef. Schema V18 unchanged. H3 gotcha routing at N=3 recurrence uses write-gate (never bypassed). Dedup: in-memory gotchaFired Set (fingerprint) — process-local, clears on restart (intentional, with charter twin-check as backstop).

Related: [[swarm-design]], [[sentinel-3-layer-architecture]]
