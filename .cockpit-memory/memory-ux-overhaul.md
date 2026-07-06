---
schema: 1
name: memory-ux-overhaul
title: Autopilot only drained fresh captures, not the backlog queue
class: gotcha
capturedAt: 2026-07-05T04:40:55.944Z
gate: save
updatedAt: 2026-07-06T01:35:54.063Z
---

Autopilot mode claimed to auto-save new notes/merges and only ask about conflicts, but it only applied that logic to items added by the current manual 'Capture' action — the ~20 already-queued backlog cards were never auto-drained, so users kept babysitting old technical cards despite Autopilot being on. Fixed in commit 527b146 by adding a reconcile effect to MemoryBrainBar that drains the entire queue (not just fresh items) whenever mode is Autopilot/Assisted, leaving only true conflicts (e.g. overwriting an existing note) for the user. Manual mode still surfaces everything for review.

Related: [[memory-trust-modes]]
- (2026-07-05) Graph was rendering below the fold with no zoom/pan, feeling unpolished. Added: scroll-to-zoom centered on cursor, drag-to-pan (dragging empty space vs. dragging a node still pins that node), auto fit-view on open/settle, and top-right +/−/fit glass control buttons (IconPlus + IconFocus, text glyphs for +/−). Only transform/opacity animated per design rules. Combined with the autopilot drain fix (queue shrinks → graph sits higher), this addressed Baz's 'graph durusu iyi degil' feedback.
- (2026-07-05) Graph was rendering below the fold with no zoom/pan, feeling unpolished. Added: scroll-to-zoom centered on cursor, drag-to-pan (dragging empty space vs. dragging a node still pins that node), auto fit-view on open/settle, and top-right +/-/fit glass control buttons (IconPlus + IconFocus, text glyphs for +/-). Only transform/opacity animated per design rules. Combined with the autopilot drain fix (queue shrinks so graph sits higher), this addressed Baz's feedback that the graph's resting position/posture looked bad.
- (2026-07-06) Graph was rendering below the fold with no zoom/pan, feeling unpolished. Added: scroll-to-zoom centered on cursor, drag-to-pan (dragging empty space vs. dragging a node still pins that node), auto fit-view on open/settle, and top-right +/-/fit glass control buttons (IconPlus + IconFocus, text glyphs for +/-). Only transform/opacity animated per design rules. Combined with the autopilot drain fix (queue shrinks so graph sits higher), this addressed Baz's feedback that the graph's resting position/posture looked bad.
