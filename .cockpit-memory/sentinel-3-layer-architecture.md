---
schema: 2
name: sentinel-3-layer-architecture
title: Sentinel is deterministic and provider-optional
class: architecture
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

Sentinel persists and deduplicates deterministic signals first, then delivers feed, toast, and macOS notifications according to severity. Optional bounded triage is a structural seam and is never load-bearing; current production wiring uses deterministic fallback. Sentinel cannot create Swarm work or act as an ambient orchestrator.
