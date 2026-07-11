---
schema: 1
name: ipc-mock-parity-blind-spot
title: IPC contract test does not verify mock.ts parity
class: architecture
capturedAt: 2026-07-09T04:01:35.537Z
gate: save
updatedAt: 2026-07-09T04:01:35.537Z
---

The IPC contract test (test/ipc-contract.test.ts) scans registerIpc.ts and preload/index.ts via regex to verify channel wiring, but never scans src/lib/mock.ts. Only compile-time method-shape enforcement (createMockApi(): CockpitApi) protects the mock. The mock can silently diverge in behavior or return shape from real handlers. This is the UI screenshot workflow's foundation — behavioral drift in the mock produces false-localhost results.

Related: [[ipc-contract]]
