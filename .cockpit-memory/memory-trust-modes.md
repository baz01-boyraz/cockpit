---
schema: 1
name: memory-trust-modes
title: Memory trust modes: Autopilot default, conflicts never auto-accepted
class: architecture
capturedAt: 2026-07-04T22:53:39.559Z
gate: save
updatedAt: 2026-07-12T04:50:43.000Z
---

Memory trust is canonical in shared policy + main-process SQLite, independently scoped for project and global brains. Project default is Autopilot; global default is Assisted. Autopilot may commit high-quality new facts and proven-idempotent merges, Assisted only new facts, and Manual nothing automatically. No mode auto-commits a conflict.

Since 2026-07-12 Autopilot also applies REVERSIBLE cleanup (archive / duplicate-merge maintenance proposals) on its own: `canAutoCleanup` in `shared/memory-policy.ts`, executed by `MemoryPipeline.applyCleanupBacklog` after a curation sweep, after Consolidate, and when a brain switches into Autopilot. It rides the same stale-checked, ledgered resolveReview path (actor `ai`); a stale item stays in the inbox. Assisted/Manual still queue every cleanup for the owner.

A conflict has two controlled paths: the owner chooses explicitly, or Hermes acts as a delegated resolver with `human-directive`, `code-verified`, `source-authority`, or `equivalent-content` basis plus rationale and evidence. Recency alone is invalid. The mutation gateway stale-checks the live note, records before/after hashes, marks AI replacements `replace/delegated`, and audits resolver provenance. If evidence is unclear, the conflict remains pending.

Related: [[memory-hub]]

Historical: v0.1.41 briefly allowed Autopilot to pick the newer conflict silently. Policy v2 supersedes that behavior; it is retained here only as the incident that motivated the controlled resolver.
