---
schema: 2
name: diff-review
title: Diff review sanitizer and Council boundary
class: architecture
gate: manual
updatedAt: 2026-07-13T05:53:28.280Z
status: active
authority: code-verified
authorityRef: owner-approved agent-memory-system-v2 migration
scope: project
confidence: high
firstSeenAt: 2026-07-13T05:53:28.280Z
lastVerifiedAt: 2026-07-13T05:53:28.280Z
reviewAfter: 2027-01-09T05:53:28.281Z
tags: runtime, memory-v2
---

The diff sanitizer is the trust boundary: sensitive paths are excluded, text is redacted and visibly budgeted, injection suspects are detected independently of any model, and evidence is fenced as untrusted. Production model judgment belongs to Council. ReviewService retains deterministic diff-stat and injectable sanitizer plumbing but its standalone model runner is disabled.
