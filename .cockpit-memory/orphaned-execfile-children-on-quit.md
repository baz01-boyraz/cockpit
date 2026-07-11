---
schema: 1
name: orphaned-execfile-children-on-quit
title: Council and Hermes CLI children survive app quit — reparented until timeout
class: architecture
capturedAt: 2026-07-09T04:01:35.568Z
gate: save
updatedAt: 2026-07-09T04:01:35.568Z
---

Council seats spawn claude/codex via execFile in EngineRunner. Hermes chat spawns hermes CLI via execFile. Services.shutdown() only kills ptys (via TerminalManager.killAll) — these execFile children are untracked. On quit, in-flight CLI children keep running until their own timeout (360s for council seats, 5min for hermes chat), burning CPU and API credits. Fix: EngineRunner and Hermes* services retain child handles and expose killAll() called from Services.shutdown.

Related: [[hermes-cli-hang-transcript-leak]], [[council-multi-engine-architecture]]
