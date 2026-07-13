---
schema: 2
name: council-session-list-ipc-gap
title: Council standalone UI exists but persisted session list IPC channel is missing
class: gotcha
capturedAt: 2026-07-09T08:40:42.882Z
gate: save
updatedAt: 2026-07-09T08:40:42.882Z
status: active
authority: legacy
scope: project
confidence: low
firstSeenAt: 2026-07-09T08:40:42.882Z
reviewAfter: 2026-10-11T05:20:43.983Z
---

E4 added Council as a standalone panel (CouncilPanel, left-rail nav, free-text spec-mode calls, verdict+scorecard rendering, in-memory session history). However the 'recent sessions' list is session-only (in-memory) — council_sessions table persists in main but has no IPC channel to list/return per-session verdicts to renderer. CouncilSessionStore.listRecent() exists in main but isn't exposed. Cross-session browsing requires a new council.sessions/list IPC channel (shared schema + main handler + mock). The E4 agent documented this gap in the UI and stayed within scope.

Related: [[council-multi-engine-architecture]], [[council-pending-crash-marker]]
