---
schema: 1
name: usage-billing-model
title: Usage/billing model — no API key, rides on user's Claude subscription
class: architecture
capturedAt: 2026-07-05T19:04:42.191Z
gate: save
updatedAt: 2026-07-05T19:04:42.191Z
---

cockpiT has zero per-token API billing and no payment integration (Stripe/etc. matches in code are only redaction regexes and test fixtures). Every AI call shells out to the user's locally-installed, already-authenticated `claude` CLI (via node-pty for terminals, execFile for one-shot `claude --print` calls) — so all model usage is billed against the user's own Claude subscription, not the app. The only direct HTTP call to api.anthropic.com is a read-only OAuth usage-quota GET in AgentUsageService (polled 60s), which doesn't consume tokens. The one automatic background consumer of model quota is MemoryAutoCapture: a 90s setInterval (started at boot in Services.ts) that drains up to 2 idle-session distill jobs per sweep via MemoryDistiller -> `claude --print`, plus swarm pipeline auto-advance (spawns the next pipeline step's claude worker automatically once a step's done-sentinel appears).

Related: [[memory-hub]], [[swarm-design]]
