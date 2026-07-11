---
schema: 1
name: memory-distiller-self-ingestion-loop
title: Memory distiller silently returns empty when fed its own prompt recursively
class: gotcha
capturedAt: 2026-07-06T02:23:30.966Z
gate: asked
updatedAt: 2026-07-06T02:23:30.966Z
---

When the memory-distiller prompt is recursively stacked inside the transcript (prompt-in-prompt nesting), the model returns empty [] observations instead of meaningful extraction — the distiller does not detect self-referential input. This causes silent data loss in the memory pipeline: no error, no flag, just a clean empty result that looks successful. One instance in the transcript showed the AI correctly identifying the recursion ('This message looks like pasted debug output...') but that was valid prose, not valid JSON, so it also fails downstream parsing. The root cause is likely in how the pipeline assembles the distiller's input — it should guard against its own prompt appearing inside the transcript it's meant to process.

Related: [[memory-distiller-cli-only]]
