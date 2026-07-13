---
schema: 2
name: swarm-outcome-events
title: Swarm card outcome events: content-free payload + last-wins fold
class: architecture
capturedAt: 2026-07-09T08:40:42.853Z
gate: save
updatedAt: 2026-07-09T08:40:42.853Z
status: active
authority: legacy
scope: project
confidence: low
firstSeenAt: 2026-07-09T08:40:42.853Z
reviewAfter: 2026-10-11T05:20:43.983Z
---

G1 built the card fate-audit layer: SwarmService now emits swarm.card_shipped / card_reworked / card_abandoned with content-free payloads (cardId + enum + specVerdictKind only — no user data, no body text). shared/outcomes.ts is a pure stateless statistics layer (CardOutcome, CardFate, computeCardOutcomeStats). OutcomeService is a read-model doing last-wins fold: a card reopened and reshipped counts once (prevents double-count fraud). Events fire from moveCard() and removeCard() — no separate IPC channel, they ride the existing event system. ship vs rework disambiguation: entering Done from any column = shipped; moving in_review to an earlier column = rework. removeCard emits abandonment only if card wasn't already Done. specVerdictKind is read at emit-time from the linked council_session, never crashes on dangling/cross-project/missing session IDs (null-safe).

Related: [[swarm-design]]
