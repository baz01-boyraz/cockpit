---
schema: 2
name: council-verdict-unreadable
title: Council verdict output is a raw text wall — needs dedicated rendering layer
class: architecture
capturedAt: 2026-07-10T01:54:48.014Z
gate: save
updatedAt: 2026-07-10T01:54:48.014Z
status: active
authority: legacy
scope: project
confidence: low
firstSeenAt: 2026-07-10T01:54:48.014Z
reviewAfter: 2026-10-11T05:20:43.983Z
---

Council engine functions correctly (5 seats spawn, peer ranking runs, chairman synthesizes, verdict/refined-spec returned) but the output UI in CouncilVerdict.tsx renders everything as an unbroken text wall: full panel width (~2000px) with no hierarchy beyond bold, chairman analysis + verdict + seat outputs all dumped at once. Baz: 'bunları kim okuyacak, user friendly insan okuyacağı gibi olmalı.' Required rendering approach: verdict-first with progressive disclosure — (1) top verdict chip (APPROVED green / NEEDS_CLARIFICATION amber / FAILED red) + one-line why summary from chairman, (2) 'what council wants from you' section — numbered questions for NEEDS_CLARIFICATION or Goal/Acceptance for APPROVED, (3) chairman analysis in a default-closed accordion, seat outputs per-seat collapsible rows (name + engine chip + one-line summary, click for full), refined spec in separate collapsible, (4) long text blocks max-width ~72ch, proper line-height/paragraph rhythm from DESIGN.md, markdown-lite rendering with distinct headers/lists/inline-code. Scorecard stays compact beside verdict but never above it — verdict is always the first thing seen.

Related: [[council-multi-engine-architecture]], [[council-persistent-store-slice]]
