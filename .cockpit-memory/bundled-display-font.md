---
schema: 2
name: bundled-display-font
title: Dashboard wordmark uses self-hosted Space Grotesk
class: decision
capturedAt: 2026-07-05T06:24:02.710Z
gate: asked
updatedAt: 2026-07-05T06:24:02.710Z
status: active
authority: legacy
scope: project
confidence: low
firstSeenAt: 2026-07-05T06:24:02.710Z
reviewAfter: 2026-10-11T05:20:43.983Z
---

The dashboard hero title was changed from rendering the project name to the product wordmark 'cockpit', set in self-hosted Space Grotesk (OFL, latin-subset woff2, ~22KB, served from public/fonts/). Chosen because CSP restricts font-src to 'self' 'data:' (no external font CDNs allowed), and Google Fonts gstatic files can be legally self-hosted under OFL. Project name moved to the eyebrow line (e.g. 'COMMAND CENTER · <project>') instead of being lost. Commit a35dac1.

Related: [[dashboard-hero-declutter]], [[rail-logo-slot]], [[csp-frame-ancestors-meta-tag]]
