---
schema: 1
name: sentinel-3-layer-architecture
title: Proposed 3-layer sentinel architecture (not yet approved)
class: architecture
capturedAt: 2026-07-08T04:16:44.708Z
gate: asked
updatedAt: 2026-07-08T04:16:44.708Z
---

AI proposed a 3-layer nöbetçi (sentinel) architecture: Layer 1 — deterministic sensors (LogIntelligenceService, exit codes, checks, quota, always-on, LLM-free); Layer 2 — Hermes oneshot triage (only fires when a signal crosses threshold, read-only diagnosis, never self-intervenes); Layer 3 — notification + chat handoff (app-shell level toast + click opens HermesWidget with preloaded context). Each notification must carry a 'next action'. Baz hasn't confirmed this architecture yet.

Related: [[live-notification-requirement]], [[sentinel-anti-noise-gotcha]]
