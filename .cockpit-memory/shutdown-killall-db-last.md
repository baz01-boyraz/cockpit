---
schema: 2
name: shutdown-killall-db-last
title: Shutdown stops engine and terminal children before the database
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

Services.shutdown uses an idempotent closing guard, stops EngineRunner children and terminal PTYs, then closes the database. This ordering prevents live subprocesses from holding resources after persistence is gone. App shutdown remains a high-impact lifecycle action and this cleanup invariant does not grant an agent permission to trigger it.
