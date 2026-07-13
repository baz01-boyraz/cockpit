---
schema: 2
name: windowed-list-hook
title: Log windowing uses fixed-height approach, memory list uses incremental render
class: decision
capturedAt: 2026-07-09T09:44:09.145Z
gate: save
updatedAt: 2026-07-09T09:44:09.145Z
status: active
authority: legacy
scope: project
confidence: low
firstSeenAt: 2026-07-09T09:44:09.145Z
reviewAfter: 2026-10-11T05:20:43.983Z
---

Two different virtualization strategies chosen based on data characteristics: (a) Log stream → fixed-height windowing (~29px rows, 8-row overscan, useWindowedList hook with spacer divs), active at 200+ rows. (b) Memory note list → incremental render (initial 80, +60 on scroll near bottom) due to variable-height cards. Both zero new dependencies, both deactivate below threshold. Log windowing assumption: single-line rows — if a log line wraps to 2 lines, small scroll drift possible at 200+.
