---
schema: 2
name: hermes-mcp-architecture
title: Hermes controls cockpiT via MCP server, not raw shell
class: architecture
capturedAt: 2026-07-06T02:31:37.270Z
gate: save
updatedAt: 2026-07-06T02:31:37.270Z
status: archived
authority: legacy
scope: project
confidence: low
firstSeenAt: 2026-07-06T02:31:37.270Z
reviewAfter: 2026-07-13T05:20:43.982Z
---

Hermes connects to cockpiT through HermesMcpServer (localhost:47615) exposing 16 narrow MCP tools (swarm, memory, git, quota, screenshot, checks, etc.). Every tool goes through existing Zod-validated IPC paths — no raw shell or SQLite access. This solves the 'Open Question 0' bypass risk: Hermes gets a fixed capability API instead of a full terminal. Tools: create_swarm_card, update_swarm_card, start_swarm_card, get_swarm_status, subscribe_card_output, get_usage_quota, get_git_status, get_git_diff_stat, get_log_intelligence, run_checks (test/typecheck/lint only), take_app_screenshot, read_memory_recent, write_memory_summary, get_pending_memory_reviews, resolve_memory_review, propose_swarm_card.

Related: [[coding-fallback-order]], [[self-initiated-card-protocol]]
