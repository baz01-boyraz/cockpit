---
schema: 1
name: selector-exact-match-terminal-heading
title: Terminals empty-state heading text overlaps with section heading by default
class: gotcha
capturedAt: 2026-07-09T09:44:09.193Z
gate: save
updatedAt: 2026-07-09T09:44:09.193Z
---

During C1 Playwright E2E development: Terminals empty-state heading ('No terminals yet') substring-matches getByRole('heading', { name: 'Terminals' }) by default because 'No terminals yet' contains 'Terminals'. Fix: required exact: true. Also: SentinelToasts renders role='alert'/'status' explicitly on <article> elements, overriding implicit article role.

Related: [[swarm-design]]
