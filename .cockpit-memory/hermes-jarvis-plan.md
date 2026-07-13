---
schema: 2
name: hermes-jarvis-plan
title: Hermes is cockpiT's bounded background orchestrator
class: architecture
capturedAt: 2026-07-05T21:31:21.396Z
gate: save
updatedAt: 2026-07-12T12:02:04.000Z
status: archived
authority: legacy
scope: project
confidence: low
firstSeenAt: 2026-07-05T21:31:21.396Z
reviewAfter: 2026-07-13T05:20:43.982Z
---

# Hermes / Jarvis direction

Hermes is one background orchestrator reached through the in-app chat today and future phone/scheduled channels later. It manages bounded MCP tools for Swarm dispatch, memory, git/log stewardship, approvals, checks, and notifications; it is not a silent coding worker and does not edit the project through a raw terminal.

Model roles are explicit: main conversation/orchestration uses `deepseek/deepseek-v4-pro`; bounded tool-less triage, transcript distillation, curation, and routine automation verdicts use `deepseek/deepseek-v4-flash`. Deterministic sensors watch continuously; Hermes spends tokens only when a meaningful signal or scheduled digest needs judgment.

Built-in operational health runs every 30 minutes inside cockpiT: it persists a content-free per-project snapshot of git, quota, Swarm, process-audit, error counts, approvals, and Memory queues. Healthy/unchanged runs are silent; only a changed anomaly reaches its signal path. A separate app-owned Automations scheduler provides one visible, pausable 09:00 briefing plus plain-language user watches. Flash may interpret the bounded snapshot and propose work, but cannot execute it; proposals wait in the normal approval queue. Native Hermes cron is not used for this boundary because non-interactive jobs auto-bypass soft approvals.

Coding remains Claude Code first and Codex second when Claude quota is unavailable. Hermes checks quota and dispatches the chosen worker through a Swarm card; it never silently substitutes itself. Self-discovered work is proposed for owner approval rather than started.

Notification flow is channel-neutral: a structured signal produces app-wide toast/macOS delivery now, with a persistent history and phone adapter later. Risky actions retain the same approval boundary regardless of channel.

Related: [[hermes-memory-stewardship-roadmap]], [[coding-fallback-order]], [[self-initiated-card-protocol]], [[sentinel-3-layer-architecture]]
