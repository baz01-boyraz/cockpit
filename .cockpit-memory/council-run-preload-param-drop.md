---
schema: 2
name: council-run-preload-param-drop
title: Preload council.run silently drops mode/spec/cardId params
class: gotcha
capturedAt: 2026-07-10T01:12:58.708Z
gate: save
updatedAt: 2026-07-10T01:12:58.708Z
status: active
authority: legacy
scope: project
confidence: low
firstSeenAt: 2026-07-10T01:12:58.708Z
reviewAfter: 2026-10-11T05:20:43.983Z
---

The preload handler for `council.run` was forwarding the IPC call without the `mode`, `spec`, and `cardId` parameters — these existed in the preload declaration but were never passed to the actual service call. This meant the spec-gate feature (convening council from a swarm card with a specific spec/mode) **never worked in real Electron**, only in the mock IPC layer where the params were correctly wired. Fixed by threading all params through the preload bridge. Failure mode: preload handlers are thin wrappers that look correct at a glance; the missing params were invisible because the function signature listed them, but they were never forwarded. Always verify preload handlers pass through every parameter end-to-end, not just the ones a unit test exercises. Links: ipc-mock-parity-blind-spot
