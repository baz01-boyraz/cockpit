---
schema: 2
name: openrouter-secret-ref-gotcha
title: OpenRouter secret ref has one canonical name
class: gotcha
gate: manual
updatedAt: 2026-07-13T05:53:28.280Z
status: active
authority: code-verified
authorityRef: owner-approved agent-memory-system-v2 migration
scope: project
confidence: high
firstSeenAt: 2026-07-13T05:53:28.280Z
lastVerifiedAt: 2026-07-13T05:53:28.280Z
reviewAfter: 2027-01-09T05:53:28.281Z
tags: runtime, memory-v2
---

Settings, EngineRunner, and usage reporting share the exported canonical secret ref openrouter.api-key. Older installs may still hold the encrypted value under the retired orchestration-era ref; reading it migrates the value to the canonical ref and removes the legacy entry. Never duplicate this ref as an independent string in another service.
