---
schema: 1
name: memory-conflict-double-gate
title: Conflict auto-resolution was gated at TWO independent levels
class: gotcha
capturedAt: 2026-07-06T02:32:23.678Z
gate: save
updatedAt: 2026-07-06T02:32:23.678Z
---

The original 'conflicts are NEVER auto-accepted' protection existed at two separate layers: (1) code — `memoryTrust.ts` `autoAcceptKinds()` explicitly excluded conflict from auto-accept with an inline comment, and (2) prompt — `AGENTS.md` item 8 instructed Hermes to 'describe the actual disagreement in one line' and ask the human. To achieve silent resolution, BOTH levels had to change. The MCP tool `resolve_memory_review` itself had no human-approval gate in its schema — it was always fully callable programmatically. The code-only and prompt-only guards each independently blocked silent resolution; changing one without the other would have left the other blocking.

Related: [[memory-trust-modes]], [[hermes-mcp-architecture]]
