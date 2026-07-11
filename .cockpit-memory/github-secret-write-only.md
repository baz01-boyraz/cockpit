---
schema: 1
name: github-secret-write-only
title: GitHub Actions secrets are write-only via API
class: gotcha
capturedAt: 2026-07-07T04:02:50.324Z
gate: save
updatedAt: 2026-07-07T04:02:50.324Z
---

GitHub Actions secrets (including MAC_SELFSIGN_P12_BASE64) are write-only — they cannot be retrieved via API/CLI, only set. This means the .p12 cert needed for local code-signing builds is stranded in CI; there is no way to pull it to a dev machine without manually re-creating it. This blocks fixing the ad-hoc-signature keychain prompt on local dev machines.

Related: [[safestorage-identity-binding]]
