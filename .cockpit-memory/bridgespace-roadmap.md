---
schema: 2
name: bridgespace-roadmap
title: Command Blocks (BridgeSpace #1) complete
class: decision
capturedAt: 2026-07-04T20:47:11.887Z
gate: save
updatedAt: 2026-07-12T05:03:45.000Z
status: active
authority: legacy
scope: project
confidence: low
firstSeenAt: 2026-07-04T20:47:11.887Z
reviewAfter: 2026-10-11T05:20:43.983Z
---

# BridgeSpace delivery

Feature #1, Command Blocks, completed in commit `b7b6940`. It delivered the Stream ↔ Blocks toggle, foldable OSC-133 command cards, exit/duration/timestamp metadata, ANSI output, copy and re-run, previous/next/latest navigation, TUI/alternate-screen suppression, bounded block/output storage, and zsh/bash integration. The original gate passed 171 unit tests.

The next BridgeSpace feature in sequence was #2, Pre-ship AI Diff Review; its durable architecture lives in [[diff-review]]. Historical “unpushed/awaiting review” status was intentionally removed because it is not durable memory.

Related: [[command-blocks-architecture]], [[diff-review]]
