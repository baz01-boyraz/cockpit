---
schema: 1
name: rail-logo-slot
title: Left-rail head is a reserved logo slot (real logo pending)
class: decision
capturedAt: 2026-07-04T23:07:44.479Z
gate: asked
updatedAt: 2026-07-05T05:58:35.288Z
---

The left-rail brand header no longer shows the 'cockpit' wordmark or 'DEVELOPER' tag — those were stripped. It is now a premium copper monogram 'c' tile (40px, warm ambient halo, hover lift) acting as a placeholder SLOT for a real app logo that Baz will create AFTER the v0.1.34 batch release. When the real logo asset arrives, it drops into this slot. Product wordmark still lives in the dashboard hero (Space Grotesk molten gradient), so removing it from the rail was intentional de-duplication, not a loss.

Related: [[bundled-display-font]], [[molten-obsidian-design]]
- (2026-07-05) Left-rail brand header was rebuilt: refined copper monogram tile, 'cockpit' wordmark set in the same Space Grotesk face as the dashboard hero (same gradient treatment), and 'developer' demoted to a quiet capsule tag instead of shouting uppercase. Intent: rail badge and hero wordmark read as siblings of one system, not two different logo treatments. Commit a35dac1 on main.
- (2026-07-05) Left-rail brand header redesigned: copper monogram tile + 'cockpit' wordmark set in the same Space Grotesk face and molten copper→amber gradient as the dashboard hero title, with 'developer' rendered as a quiet capsule tag instead of loud uppercase — rail and hero are meant to read as siblings, not independent designs.
