---
schema: 2
name: hermes-cockpit-decoupled-architecture
title: cockpiT does not package Hermes — 4-point decoupled integration surface
class: architecture
capturedAt: 2026-07-06T03:19:25.929Z
gate: save
updatedAt: 2026-07-06T06:27:41.587Z
status: archived
authority: legacy
scope: project
confidence: low
firstSeenAt: 2026-07-06T03:19:25.929Z
reviewAfter: 2026-07-13T05:20:43.982Z
---

Hermes lives at ~/.hermes via its own installer (npm global); cockpiT resolves it via resolveBin('hermes') with no npm dependency on the hermes-agent package. The entire integration surface is 4 points: (1) CLI flags --oneshot/--ignore-rules/-m, (2) MCP client via hermes mcp add targeting cockpiT's local server at 127.0.0.1:47615, (3) ~/.hermes/config.yaml approvals.deny format for blocked git commands, (4) AGENTS.md auto-reading convention. An update that breaks any of these produces visible errors (resolveBin failure or JSON parse errors with ok:false), not silent corruption. No Hermes local state dependency — everything lives in cockpiT's SQLite/git.

Related: [[hermes-mcp-architecture]], [[command-blocks-architecture]]
- (2026-07-06) Hermes MCP is a single global process shared across all projects, never per-project. Every tool requires the model to supply a projectId string (swarmProjectSchema/swarmCreateCardSchema), but the model was never given the real cockpit DB id — it invented one from scratch, causing raw SQLite FK crashes (kanban_cards.project_id REFERENCES projects(id)). Fix: HermesChatService.ask() now passes the real projectId as COCKPIT_PROJECT_ID env var to the spawned Hermes process. AGENTS.md updated to instruct the model to read this env var and use it verbatim. .dev-cockpit/project.json does NOT contain the cockpit DB id — only name/path/techStack/terminals/railway.projectId. The Hermes CL tool context (HermesToolContext) also lacks ProjectService access, preventing auto-registration workarounds in the tool layer.
