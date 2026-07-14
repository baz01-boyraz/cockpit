---
schema: 2
name: council-chair-codex-fallback-requirement
title: Council chair and fallback list is entirely Codex, no policy-aware fallback
class: decision
capturedAt: 2026-07-14T19:04:56.165Z
gate: save
updatedAt: 2026-07-14T19:04:56.165Z
status: active
authority: observed
scope: project
confidence: medium
firstSeenAt: 2026-07-14T19:04:56.165Z
reviewAfter: 2026-10-12T19:04:56.165Z
---

Council.ts shows 3 of 5 seats are Codex/Builder Claude, only First Principles uses OpenRouter; the chair is Codex and the fallback list is empty. If Codex becomes unavailable, the decision backbone collapses despite 'multi-engine' architecture. At minimum, chair needs a real, policy-aware fallback.
- (2026-07-14) Chair fallback RESOLVED in 38edb84: `CHAIRMAN.fallbacks` is now `[{ engine: 'claude', model: sonnet5 }]`, regression-tested in council-llm/council-analysis tests. The wider 3-of-5-seats-on-Codex concentration remains an owner-accepted risk (Codex runs on monthly subscription auth).
