---
schema: 2
name: cli-error-sanitization-gotcha
title: CLI error messages leak prompt bytes to audit log and UI
class: gotcha
capturedAt: 2026-07-14T19:39:05.343Z
gate: save
updatedAt: 2026-07-14T19:39:05.343Z
status: active
authority: observed
scope: project
confidence: medium
firstSeenAt: 2026-07-14T19:39:05.343Z
reviewAfter: 2026-10-12T19:39:05.343Z
---

Node execFileAsync error includes full command line with the prompt as the last argument. EngineRunner.runCli passed this raw error up, so codex/claude CLI failures leaked transcript bytes into audit_log, memory_capture_queue.error, and AuditPanel payload. Fix: added mapCliFailure to return fixed-string error codes (like runOpenRouter), preventing prompt leakage. Verified by manual node test and existing test suite (1438 tests green).
