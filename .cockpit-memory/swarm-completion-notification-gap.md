---
schema: 1
name: swarm-completion-notification-gap
title: Swarm task completion has no proactive push to Hermes/orchestrator
class: architecture
capturedAt: 2026-07-07T14:16:18.156Z
gate: save
updatedAt: 2026-07-07T14:16:18.156Z
---

Swarm completions are detected only via .cockpit-done sentinel file polling (Stop hook), terminal:exit events, or renderer-side RUNNING_POLL_MS polling. No webhook, IPC event, or callback targets Hermes/the orchestrator on task finish. Baz explicitly wants Hermes to auto-deliver a result summary when a Swarm task completes so he doesn't have to manually check.
