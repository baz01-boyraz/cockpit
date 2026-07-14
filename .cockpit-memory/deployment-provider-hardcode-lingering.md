---
schema: 2
name: deployment-provider-hardcode-lingering
title: Deployment problem suggestion still hard-coded to Railway
class: gotcha
capturedAt: 2026-07-14T17:41:47.525Z
gate: save
updatedAt: 2026-07-14T18:01:51Z
status: archived
authority: observed
scope: project
confidence: medium
firstSeenAt: 2026-07-14T17:41:47.525Z
reviewAfter: 2026-10-12T17:41:47.525Z
---

Despite prior conversations about provider-agnostic behavior, the 'Deployment problem → Railway' suggestion remains hard-coded in the codebase and was not removed in the latest release. The release appeared fixed because tests only covered the `;244;...m` ANSI variant, not the actual `33;58;43m` variant present in production logs. Fix: remove hard-coded provider reference; make deployment problem detection provider-agnostic.

Archived after the verified correction; the durable lesson was consolidated
into [[sanitize-ansi-regex-escaped-source]].
