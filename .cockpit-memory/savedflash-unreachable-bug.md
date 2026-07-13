---
schema: 2
name: savedflash-unreachable-bug
title: MemoryReader savedFlash was unreachable due to mode-order bug
class: decision
capturedAt: 2026-07-09T09:44:09.131Z
gate: save
updatedAt: 2026-07-09T09:44:09.131Z
status: active
authority: legacy
scope: project
confidence: low
firstSeenAt: 2026-07-09T09:44:09.131Z
reviewAfter: 2026-10-11T05:20:43.983Z
---

MemoryReader's "saved" flash indicator was unreachable: saveDraft() sets mode('read') before savedFlash(true), but the flash element was gated behind mode === 'edit'. Fix: moved the flash indicator outside the mode ternary into memreader__actions so it renders in read mode. Discovered by C1 Playwright agent during selector investigation, fixed in F4.

Related: [[memory-hub]]
