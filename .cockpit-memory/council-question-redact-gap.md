---
schema: 2
name: council-question-redact-gap
title: Council question field bypasses redactText — was sent unredacted to third-party
class: gotcha
capturedAt: 2026-07-08T03:21:32.693Z
gate: save
updatedAt: 2026-07-08T03:21:32.693Z
status: active
authority: legacy
scope: project
confidence: low
firstSeenAt: 2026-07-08T03:21:32.693Z
reviewAfter: 2026-10-11T05:20:43.983Z
---

During council runs, the `question` field (built from card title + body in SwarmPanel) was NOT passed through `redactText` before being sent to OpenRouter/DeepSeek and stored in `council_sessions.question`. Meanwhile, `specText` and `diff` WERE redacted in the same flow (CouncilService.prepareSpec). This is a classic asymmetric-redaction bug: adding a new data path to the council pipeline and forgetting to apply redaction. Fixed by adding `redactText(opts.question.trim())` in CouncilService.run(). Every new string field introduced into the council data flow must go through redactText — never assume the caller has done it. Found by Argos security review (MEDIUM M1).

Related: [[council-multi-engine-architecture]], [[security-enforcement]]
