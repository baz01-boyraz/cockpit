---
schema: 2
name: sentinel-notification-tiering
title: Sentinel notifications protect attention by severity
class: decision
gate: manual
updatedAt: 2026-07-13T05:54:22.765Z
status: active
authority: human-directive
authorityRef: owner-approved agent-memory-system-v2 migration
scope: project
confidence: high
firstSeenAt: 2026-07-13T05:54:22.765Z
lastVerifiedAt: 2026-07-13T05:54:22.765Z
reviewAfter: 2027-01-09T05:54:22.767Z
tags: runtime, memory-v2
---

Sentinel uses three delivery levels: info stays in the feed, notice adds a bottom-right toast, and alert adds toast plus macOS notification and app badge. Quiet hours and suppression protect attention. The system earns trust by emitting few accurate notifications with bounded evidence and one next action, never by continuously narrating healthy state.
