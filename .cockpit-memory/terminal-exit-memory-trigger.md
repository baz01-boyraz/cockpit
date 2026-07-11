---
schema: 1
name: terminal-exit-memory-trigger
title: Terminal exit now triggers immediate memory capture
class: decision
capturedAt: 2026-07-06T02:31:37.303Z
gate: save
updatedAt: 2026-07-06T02:31:37.303Z
---

Added terminal:exit event listener to MemoryPipeline. When a terminal session with role='claude' closes, memory capture fires immediately instead of waiting for the 10-minute idle poll. The 90-second idle poll remains as fallback for sessions that are abandoned without explicit close.

Related: [[memory-distiller-cli-only]]
