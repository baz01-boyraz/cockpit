---
schema: 1
name: main-process-uncaught-handler
title: Missing global error handlers cause silent Electron main-process crashes
class: architecture
capturedAt: 2026-07-06T02:29:02.894Z
gate: save
updatedAt: 2026-07-06T02:29:02.894Z
---

`electron/main/index.ts` had zero `uncaughtException` or `unhandledRejection` handlers. Node.js defaults to killing the entire process on any unhandled async error with no visible dialog, log, or console output — matching Baz's 'app just disappears with no message' symptom. Fixed by adding handlers that write to `~/Library/Application Support/cockpit/main-crash.log` and continue running. Any future async code in main process (memory sweeps, update checks, IPC handlers) that might throw unexpectedly will now produce a recoverable log entry instead of a silent crash.
