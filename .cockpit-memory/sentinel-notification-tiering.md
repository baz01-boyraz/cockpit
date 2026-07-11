---
schema: 1
name: sentinel-notification-tiering
title: Notification tiering: info→feed, notice→toast, alert→toast+macOS+badge
class: decision
capturedAt: 2026-07-08T05:16:57.442Z
gate: save
updatedAt: 2026-07-08T05:16:57.442Z
---

Three-level notification model locked in: info severity → feed only (no push), notice → sağ alt toast notification, alert → toast + macOS native notification + app badge. Low-severity items accumulate in a daily digest. A quiet-hours mode and a one-tap kill-switch exist from day one. Rationale: the system's biggest enemy is noise — few but accurate notifications build a 'when Hermes speaks, it matters' reflex.

Related: [[sentinel-anti-noise-gotcha]]
