---
schema: 1
name: redaction-intake-once
title: Hermes chat redaction applied once at intake, not at every composition point
class: architecture
capturedAt: 2026-07-09T05:11:04.828Z
gate: save
updatedAt: 2026-07-09T05:11:04.828Z
---

Redaction runs once on user message in HermesChatService.ask() before the message touches: (1) the in-memory turn Map, (2) the hermes_chat_turns DB row, (3) the CLI argv (transcript prompt), (4) any re-transmission in the next turn. Assistant stdout is symmetrically redacted so model-echo of secrets doesn't leak into renderer/DB/transcript. This prevents secret injection through the composition gap — if redaction were applied per-composition-point, a missed path between intake and any output could leak. The policy applies to all three data paths equally: CLI, DB, transcript.

Related: [[hermes-cli-hang-transcript-leak]], [[hermes-chat-transcript-redact-gap]]
