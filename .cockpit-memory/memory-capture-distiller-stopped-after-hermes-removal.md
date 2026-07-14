---
schema: 2
name: memory-capture-distiller-stopped-after-hermes-removal
title: Memory capture was fully broken after Hermes removal because distiller called deleted Hermes binary
class: gotcha
capturedAt: 2026-07-14T05:07:35.193Z
gate: save
updatedAt: 2026-07-14T05:07:35.193Z
status: active
authority: observed
scope: project
confidence: medium
firstSeenAt: 2026-07-14T05:07:35.193Z
reviewAfter: 2026-10-12T05:07:35.193Z
---

After Hermes was removed, the automatic memory capture did not just miss Codex sessions: the entire capture pipeline was dead because the distiller module still called the hermes binary (HERMES_RUNTIME_ENABLED was false, but the distiller was not provider-neutral and crashed on missing binary). The fix required rewriting the distillation and curation engine to be fully provider-agnostic, using the existing engine runner instead of a removed Hermes-specific binary. Both auto-capture and exit capture now work without any Hermes runtime dependency.

Related: [[runtime-architecture-no-hermes]], [[memory-analysis-provider-neutral]], [[memory-hub]]
