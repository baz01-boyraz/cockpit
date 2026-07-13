---
schema: 2
name: hermes-no-docker
title: Hermes runs locally without Docker container isolation
class: decision
capturedAt: 2026-07-06T02:31:37.307Z
gate: save
updatedAt: 2026-07-06T02:31:37.307Z
status: archived
authority: legacy
scope: project
confidence: low
firstSeenAt: 2026-07-06T02:31:37.307Z
reviewAfter: 2026-07-13T05:20:43.982Z
---

Baz explicitly rejected container isolation. Hermes runs directly on the macOS host. Security relies on the MCP server's limited tool surface and command-approval three-layer system instead of network/container sandboxing. All the security docs about container isolation and network lockdown are irrelevant to this setup.

Related: [[hermes-mcp-architecture]], [[command-approval-three-layer]]
