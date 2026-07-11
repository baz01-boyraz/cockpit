---
schema: 1
name: sentinel-backbone-first-sequencing
title: Sentinel build order: backbone (LLM-free) before intelligence
class: decision
capturedAt: 2026-07-08T05:16:57.436Z
gate: save
updatedAt: 2026-07-08T05:16:57.436Z
---

The sentinel/watchtower system is built in 4 phases, with a strict sequencing rule: Phase A (LLM-free backbone: signal bus, sensor connections, toast, notification center, chat handoff) comes first and alone delivers ~70% of the value. Phase B (Hermes triage via DeepSeek) layers on top. Reason: the backbone must survive Hermes crashes (sensors + notifications work without Hermes), and LLM latency/errors must not poison trust in week one. Also aligns with Baz's standing 'determine then build' preference.

Related: [[baz-prefers-determine-then-build]], [[sentinel-anti-noise-gotcha]]
