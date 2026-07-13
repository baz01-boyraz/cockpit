---
schema: 2
name: jsdoc-bold-markdown-close-gotcha
title: JSDoc `/**` inside bold-markdown sequence early-closes the comment
class: gotcha
capturedAt: 2026-07-08T02:47:04.607Z
gate: save
updatedAt: 2026-07-08T02:47:04.607Z
status: active
authority: legacy
scope: project
confidence: low
firstSeenAt: 2026-07-08T02:47:04.607Z
reviewAfter: 2026-10-11T05:20:43.983Z
---

In TypeScript/Electron JSDoc comments, a `/**` sequence inside bold markdown like `**Goal**/` is parsed as the closing `*/` of the comment block, cutting the docstring short. Fix: avoid markdown bold delimiters near `*/` — rewrite as plain text like 'bold Goal/Context' or use non-star emphasis delimiters inside JSDoc. Discovered during council brief JSDoc phase, blocked prompt assembly.
