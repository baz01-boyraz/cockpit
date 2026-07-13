---
schema: 2
name: hermes-cli-hang-transcript-leak
title: Hermes CLI hang leaked full transcript in error — now sanitized + escalates
class: gotcha
capturedAt: 2026-07-06T04:58:56.351Z
gate: save
updatedAt: 2026-07-06T04:58:56.351Z
status: archived
authority: legacy
scope: project
confidence: low
firstSeenAt: 2026-07-06T04:58:56.351Z
reviewAfter: 2026-07-13T05:20:43.982Z
---

Commit fab2fcd fixed a security issue where Hermes CLI silently hung and then returned the entire user conversation transcript in the error message. Fix: return a generic message instead of the raw transcript, and on consecutive second timeout detect genuinely stuck (not just slow) and escalate with a clearer signal. Test coverage included.

Related: [[command-blocks-architecture]], [[cli-default-model-opus-1m]]
