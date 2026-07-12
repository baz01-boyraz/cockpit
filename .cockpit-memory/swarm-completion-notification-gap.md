---
schema: 1
name: swarm-completion-notification-gap
title: Successful Swarm completion proactively reaches Hermes Pro
class: architecture
capturedAt: 2026-07-07T14:16:18.156Z
gate: save
updatedAt: 2026-07-12T05:44:00.000Z
---

The former notification gap was closed on 2026-07-12. A successful done-signal or clean worker exit now stages a structured `swarm-completion` Sentinel signal before any model call. Only bounded, redacted evidence from that card/session reaches tool-less Hermes V4 Pro; the enriched signal is then delivered once through the app toast and macOS notification, with Review card and Ask Hermes actions. Pro failure uses a deterministic fallback, staged rows resume after restart, and nonzero worker exits remain a separate failure signal.
