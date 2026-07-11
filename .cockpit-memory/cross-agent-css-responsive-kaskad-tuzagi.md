---
schema: 1
name: cross-agent-css-responsive-kaskad-tuzagi
title: Global @media blocks trapped inside usage.css during F2 split
class: gotcha
capturedAt: 2026-07-09T09:44:09.200Z
gate: save
updatedAt: 2026-07-09T09:44:09.200Z
---

During F2 CSS split, the usage.css block contained global responsive @media rules (.topbar__*, .shell, .dash__cols, .panel__title) at its bottom — these were not usage-specific, but their original cascade position mattered because .panel__title base lives in components.css AFTER where the media block was. Moving them would invert cascade at ≤1040px. Fix: left that block in components.css at its original relative position rather than moving it to usage.css.

Related: [[cross-agent-css-coordination]]
