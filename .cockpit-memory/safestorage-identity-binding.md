---
schema: 2
name: safestorage-identity-binding
title: safeStorage encryption is bound to app code signing identity
class: gotcha
capturedAt: 2026-07-07T01:41:08.925Z
gate: asked
updatedAt: 2026-07-07T01:41:08.925Z
status: active
authority: legacy
scope: project
confidence: low
firstSeenAt: 2026-07-07T01:41:08.925Z
reviewAfter: 2026-10-11T05:20:43.983Z
---

Electron's `safeStorage` encryption is tied to the app's code signing identity. A key encrypted by a dev Electron process (unsigned Electron binary) cannot be decrypted by the signed `/Applications/cockpiT.app` and vice versa. The app silently treats "can't decrypt" as "no key stored", so the ring stays offline without any visible error. This means a key stored through one copy of the app is invisible to another, even on the same machine.

Related: [[openrouter-secret-ref-gotcha]]
