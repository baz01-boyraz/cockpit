---
schema: 1
name: command-approval-three-layer
title: Hermes approval system has three layers verified from source
class: reference
capturedAt: 2026-07-06T02:31:37.298Z
gate: save
updatedAt: 2026-07-06T02:31:37.298Z
---

Reading tools/approval.py (2986 lines): (1) Hardline floor — rm -rf /, mkfs, fork bombs, shutdown/reboot, raw disk dd — blocked in EVERY mode (yolo, approvals.mode=off, cron, oneshot). (2) User deny list (approvals.deny in config.yaml) — unconditional blocks we configure. (3) Dangerous list (force-push, rm -r, chmod 777, curl|bash) — interactive approval in normal mode, auto-bypassed in oneshot/telegram. oneshot mode shows 'approvals are auto-bypassed' warning. Only layers 1+2 are unconditional.

Related: [[hermes-mcp-architecture]]
