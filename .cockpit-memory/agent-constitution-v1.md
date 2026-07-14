---
schema: 2
name: agent-constitution-v1
title: Agent Constitution v1 — Terminal agent directly works in repo, Swarm only on explicit request, lifecycle actions require explicit consent
class: decision
capturedAt: 2026-07-14T05:07:35.132Z
gate: save
updatedAt: 2026-07-14T05:07:35.132Z
status: active
authority: observed
scope: project
confidence: medium
firstSeenAt: 2026-07-14T05:07:35.132Z
reviewAfter: 2026-10-12T05:07:35.132Z
---

Claude/Codex terminal agents always work directly in the current repository. Swarm/Council is never used or suggested unless the user explicitly says "use Swarm" in the current message. Terminal agents never look for COCKPIT_PROJECT_ID and never treat its absence as a blocker. app:refresh, app quit/restart, and /Applications installation require both explicit consent in the current message and a single-use Cockpit UI approval token. Old session consent does not carry forward. Commit, push, release, and refresh are separate permissions. An agent unsure about a high-impact action does not run it; it states what is needed in one sentence. Memory provides behavioral context; critical safety/workflow rules come from a short constitution loaded every time, not from memory. A blocked action is not bypassed via alternative commands. The task report explicitly states which checks ran and which high-impact actions were deliberately skipped.

Related: [[direct-agent-contract]], [[swarm-worker-contract]], [[council-contract]], [[refresh-approval-token]]
