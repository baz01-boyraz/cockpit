---
schema: 2
name: node-pty-threadsafe-abort
title: node-pty native crash (SIGABRT) from ThreadSafeFunction
class: gotcha
capturedAt: 2026-07-07T02:11:51.370Z
gate: save
updatedAt: 2026-07-07T02:11:51.370Z
status: active
authority: legacy
scope: project
confidence: low
firstSeenAt: 2026-07-07T02:11:51.370Z
reviewAfter: 2026-10-11T05:20:43.983Z
---

node-pty delivers terminal:data and terminal:exit events through Napi::ThreadSafeFunction::CallJS from a native (libuv) thread. If any JS listener on the event bus throws synchronously, the exception goes back to native code — not a normal JS call stack — and triggers SIGABRT (process abort). This bypasses uncaughtException entirely, which is why main-crash.log was empty despite repeated crashes. Diagnostic clue: crash reports live in ~/Library/Logs/DiagnosticReports/Retired/ as Electron/AppName-YYYY-MM-DD-*.crash with pty.node and ThreadSafeFunction in the backtrace. Fix: wrap every listener in CockpitEvents.emitTyped in its own try/catch, and wrap the proc.onData/proc.onExit callbacks in TerminalManager that are the actual native boundary.
