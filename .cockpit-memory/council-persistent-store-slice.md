---
schema: 1
name: council-persistent-store-slice
title: Council store: promise resolves in slice action, not component
class: architecture
capturedAt: 2026-07-10T01:12:58.719Z
gate: save
updatedAt: 2026-07-10T01:12:58.719Z
---

Council state moved from ephemeral component state to a Zustand slice with two key design rules: (1) `conveneCouncil` promise resolves inside the slice action, not in a component useEffect — this means a council run that finishes while the user is on a different panel still writes to store. (2) `resetCouncil(projectId)` preserves state when switching between panels for the same project (view switch) but clears on genuine project change. This is enforced by comparing the stored projectId against the current project; a same-project reset is a no-op for the active run. Links: council-multi-engine-architecture,council-panel-session-eviction
