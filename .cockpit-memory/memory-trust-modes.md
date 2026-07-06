---
schema: 1
name: memory-trust-modes
title: Memory trust modes: Autopilot default, conflicts never auto-accepted
class: architecture
capturedAt: 2026-07-04T22:53:39.559Z
gate: save
updatedAt: 2026-07-04T22:53:39.559Z
---

The memory review-queue UX has a per-project trust dial (localStorage): Autopilot (default) / Assisted / Manual. Autopilot auto-saves both new notes AND merges, leaving only genuine conflicts for the user. Manual/Assisted queue more. Hard invariant across ALL modes: a conflict (overwriting an existing note) is NEVER auto-accepted — that always requires the user's decision. Capture also shows a report card (which session, auto-saved names in green ✓, items awaiting review) so nothing saves silently. Implemented renderer-only (src/lib/memoryTrust.ts, MemoryBrainBar.tsx) via the resolveReview loop without touching the backend gate, to avoid colliding with the concurrent backend memory agent's work. Graph is full-width in graph mode with an idle-pause rAF loop (0 frames when settled) + cached offscreen atmosphere.

Related: [[memory-hub]]
