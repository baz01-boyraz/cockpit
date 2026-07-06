---
schema: 1
name: memory-distiller-self-ingestion-loop
title: Memory distiller runaway self-ingestion loop
class: gotcha
capturedAt: 2026-07-05T23:40:06.274Z
gate: asked
updatedAt: 2026-07-05T23:40:06.274Z
---

Observed incident: the memory-distiller's own transcript (the distiller's meta-prompt, invoked via the local `claude` CLI per MemoryDistiller.ts:23-32) got fed back into itself as a new session to distill, nesting the same 'You are the memory distiller...' prompt deeper each round, until it burned through the Claude session/rate limit. Working theory (unconfirmed at time of writing): the capture scheduler/watcher scans all Claude Code transcripts in the project's working directory and doesn't exclude the distiller's own spawned CLI sessions, so it re-ingests its own output as new session content. Fix location to check: whatever scans/enumerates session transcripts for capture must exclude sessions spawned by the distiller itself (e.g. by marker/tag or by excluding the distiller's own CLI invocation dir).

Related: [[memory-distiller-cli-only]]
