---
schema: 2
name: runtime-architecture-no-hermes
title: Runtime architecture: Hermes removed
class: architecture
gate: manual
updatedAt: 2026-07-13T05:20:43.982Z
status: active
authority: human-directive
authorityRef: owner-approved agent-memory-system-v2 migration
scope: project
confidence: high
firstSeenAt: 2026-07-13T05:20:43.982Z
lastVerifiedAt: 2026-07-13T05:20:43.982Z
reviewAfter: 2027-01-09T05:20:43.983Z
supersedes: hermes-jarvis-plan, hermes-cockpit-decoupled-architecture, hermes-mcp-architecture, coding-fallback-order
tags: runtime, memory-v2
---

Hermes has been removed from the active cockpiT architecture. Interactive Claude Code and Codex terminals work directly in the current repository. Swarm is a separate, explicit UI workflow; direct terminal work never requires a Cockpit project id or card dispatch. Critical behavior is enforced by the human-approved runtime contracts, not inferred from Memory.
