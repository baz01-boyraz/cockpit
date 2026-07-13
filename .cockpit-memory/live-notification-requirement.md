---
schema: 2
name: live-notification-requirement
title: Live notifications are tab-independent and actionable
class: architecture
gate: manual
updatedAt: 2026-07-13T05:53:28.280Z
status: active
authority: human-directive
authorityRef: owner-approved agent-memory-system-v2 migration
scope: project
confidence: high
firstSeenAt: 2026-07-13T05:53:28.280Z
lastVerifiedAt: 2026-07-13T05:53:28.280Z
reviewAfter: 2027-01-09T05:53:28.281Z
tags: runtime, memory-v2
---

Important bugs, failures, and reportable events must reach Baz regardless of the selected tab through the notification feed, a bottom-right toast, and macOS notification for alert severity. Each notification carries bounded context and one next action. Delivery is driven by deterministic persisted signals; it does not require an ambient orchestrator or chat persona.
