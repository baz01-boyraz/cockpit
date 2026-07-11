---
schema: 1
name: memory-write-gate-asymmetric
title: Write gate has asymmetric treatment across three write paths
class: decision
capturedAt: 2026-07-08T05:48:33.764Z
gate: save
updatedAt: 2026-07-08T05:48:33.764Z
---

The memory write gate (shared/memory-gate.ts) applies differently per path: (1) Hermes tool path (write_memory_summary) → three-tier accept/review/reject; secrets rejected with a charter-referencing tool error. (2) Auto-capture pipeline (MemoryPipeline.ts) → same three-tier but secrets silently dropped (not queued, not written, audit logged). (3) Human UI write path (registerIpc services.memory.write) → intentionally gate-free, no gate call at all. Rationale: owner sovereignty — the human should never be friction-blocked by a gate that exists to constrain AI behavior. This asymmetry is not documented in any single place and would be non-obvious to a future developer adding a fourth write path.

Related: [[memory-trust-modes]], [[memory-conflict-double-gate]], [[memory-authority-trust-ladder]]
