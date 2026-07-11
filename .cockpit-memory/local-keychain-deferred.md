---
schema: 1
name: local-keychain-deferred
title: Baz deferred fixing local keychain prompt on ad-hoc builds
class: decision
capturedAt: 2026-07-07T04:02:50.332Z
gate: save
updatedAt: 2026-07-07T04:02:50.332Z
---

The local `app:refresh` build produces an ad-hoc signed app because the code-signing .p12 cert is only in GitHub secrets. macOS cannot persist 'Always Allow' for safeStorage on ad-hoc signed apps, so it prompts every launch. Baz decided not to fix this now (the actual cert is unreachable locally). The fix would require importing the .p12 into the local keychain.

Related: [[safestorage-identity-binding]], [[github-secret-write-only]]
