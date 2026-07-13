---
schema: 2
name: sentinel-anti-noise-gotcha
title: Sentinel must fingerprint signals to avoid self-ingestion noise
class: gotcha
capturedAt: 2026-07-08T04:16:44.701Z
gate: save
updatedAt: 2026-07-08T04:16:44.701Z
status: active
authority: legacy
scope: project
confidence: low
firstSeenAt: 2026-07-08T04:16:44.701Z
reviewAfter: 2026-10-11T05:20:43.983Z
---

During an earlier phase, log-intelligence was reading cockpit's own Claude TUI output and generating false 'build failed' insights. The corrective pattern for the sentinel system: every signal must carry a fingerprint (dedup key), the same signal must not re-notify within a cooldown window, and low-severity signals must batch into a daily digest instead of firing individual toasts. A single false alarm per week trains users to ignore notifications.

Related: [[live-notification-requirement]]
