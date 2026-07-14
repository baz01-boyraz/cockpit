---
schema: 2
name: memory-capture-provider-neutral
title: Memory capture is now provider-neutral: both Claude and Codex are equal sources, Cockpit is single writer
class: decision
capturedAt: 2026-07-14T05:07:35.148Z
gate: save
updatedAt: 2026-07-14T05:07:35.148Z
status: archived
authority: observed
scope: project
confidence: medium
firstSeenAt: 2026-07-14T05:07:35.148Z
reviewAfter: 2026-10-12T05:07:35.148Z
---

Cockpit captures both Claude and Codex session transcripts via separate adapters. Neither Claude nor Codex writes memory files directly; Cockpit is the sole writer. The distillation/curation engine runs provider-agnostic on Cockpit's own engine runner, independent of the removed Hermes runtime. System prompt, reasoning, tool calls, and tool outputs are never persisted. Each captured session undergoes redaction, dedup, quality gating, and trust mode before creating or updating a note. Provenance (Claude/Codex, session ID) is stored in the ledger and visible in the UI. Archived notes are not considered current by agents unless specifically asked for history.

Related: [[memory-hub]], [[memory-analysis-provider-neutral]], [[memory-trust-modes]], [[runtime-architecture-no-hermes]]
