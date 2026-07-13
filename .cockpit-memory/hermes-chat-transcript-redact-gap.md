---
schema: 2
name: hermes-chat-transcript-redact-gap
title: Hermes chat sends full transcript to OpenRouter without redactText
class: gotcha
capturedAt: 2026-07-09T04:01:35.545Z
gate: save
updatedAt: 2026-07-09T04:01:35.545Z
status: archived
authority: legacy
scope: project
confidence: low
firstSeenAt: 2026-07-09T04:01:35.545Z
reviewAfter: 2026-07-13T05:20:43.982Z
---

HermesChatService.ask() sends the user's message plus the full conversation transcript to the hermes CLI (→ OpenRouter) with no redactText call. A pasted secret goes out verbatim. This is a different path than the council question redact gap (which was fixed) — the chat service is entirely unguarded. Additionally the hermes CLI runs in the project cwd and reads project files outside cockpit's redaction control entirely.

Related: [[council-question-redact-gap]], [[hermes-chat-backend]]
