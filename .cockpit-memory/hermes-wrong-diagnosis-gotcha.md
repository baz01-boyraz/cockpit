---
schema: 1
name: hermes-wrong-diagnosis-gotcha
title: Hermes self-proposed swarm card had wrong root cause
class: gotcha
capturedAt: 2026-07-08T01:24:19.366Z
gate: save
updatedAt: 2026-07-08T01:24:19.366Z
---

Hermes proposed a swarm card claiming exited terminal sessions fill the MAX_TERMINALS limit. This symptom teardown was wrong: countActiveAgents (shared/dashboard-assembly.ts:25) counts only `status==='running'` claude/codex sessions, so exited sessions cannot fill the limit. The real cause: SwarmService.ts:156-157 and :204 keep worker terminal processes alive indefinitely when a card moves to In-review, never disposing them. These terminals stay 'running' forever and actually fill MAX_TERMINALS. The incident shows Hermes needs a mandatory 'verify claim against code, show file:line' step before proposing a fix — it proposed with unverified root cause that would have wasted quota on the wrong fix.

Related: [[self-initiated-card-protocol]], [[swarm-design]], [[swarm-completion-notification-gap]]
