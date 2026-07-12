---
schema: 1
name: sentinel-3-layer-architecture
title: Sentinel three-layer architecture
class: architecture
capturedAt: 2026-07-08T04:16:44.708Z
gate: save
updatedAt: 2026-07-12T06:30:00.000Z
---

Sentinel uses three layers: (1) always-on deterministic, LLM-free sensors; (2) bounded V4 Flash triage only after a persisted thresholded signal; (3) app/macOS delivery with a next action and Hermes chat handoff. Specialist Swarm completion summaries use V4 Pro after evidence is persisted. Healthy or unchanged operational-health sweeps never invoke a model, and self-discovered coding work is proposed for approval rather than started.

Related: [[live-notification-requirement]], [[sentinel-anti-noise-gotcha]]
