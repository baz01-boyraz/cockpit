---
schema: 2
name: usage-scorecard-default-collapsed
title: Judgment scorecard relegated to collapsible <details>, defaults closed
class: decision
capturedAt: 2026-07-10T01:12:58.727Z
gate: asked
updatedAt: 2026-07-10T01:12:58.727Z
status: active
authority: legacy
scope: project
confidence: low
firstSeenAt: 2026-07-10T01:12:58.727Z
reviewAfter: 2026-10-11T05:20:43.983Z
---

The judgment scorecard (`.scoreband`) was moved from always-visible to a native `<details>` element, default closed. The rationale: 'No data yet' tiles were visually noisy when empty, and the scorecard is secondary information compared to the per-engine capacity view. Native `<details>` gives keyboard/focus-visible behavior for free. This is a UX demotion by design, not a placeholder.
