---
schema: 2
name: codex-working-counter-per-step
title: Codex 'Working (N s)' counter is per-step, not total session time
class: gotcha
capturedAt: 2026-07-14T05:05:28.880Z
gate: save
updatedAt: 2026-07-14T05:05:28.880Z
status: active
authority: observed
scope: project
confidence: medium
firstSeenAt: 2026-07-14T05:05:28.880Z
reviewAfter: 2026-10-12T05:05:28.880Z
---

The 'Working (N s)' indicator shown in Codex agent sessions is the duration of the current thinking step, not the total elapsed time of the session. Total session time can be much longer (e.g., 3+ hours) and includes multiple steps, tool calls, and test runs. This can mislead developers into thinking the agent is stuck when it is actually making progress.
