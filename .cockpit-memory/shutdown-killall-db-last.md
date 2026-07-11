---
schema: 1
name: shutdown-killall-db-last
title: Services.shutdown ordering: killAlls → db.close(last)
class: architecture
capturedAt: 2026-07-09T05:11:04.797Z
gate: save
updatedAt: 2026-07-09T05:11:04.797Z
---

Services.shutdown() guarantees all in-flight CLI children (EngineRunner, HermesChat, HermesTriage) and pty sessions (TerminalManager) are killAll'd BEFORE db.close() runs. Proven by invocationCallOrder test. A `closing` boolean guard makes second shutdown() no-op. This ordering prevents orphan subprocesses from holding file handles that would block clean DB close on macOS.

Related: [[main-process-uncaught-handler]], [[orphaned-execfile-children-on-quit]]
