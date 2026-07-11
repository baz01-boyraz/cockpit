---
schema: 1
name: codex-exec-stdin-hang
title: Codex exec blocks forever if stdin not closed
class: gotcha
capturedAt: 2026-07-08T01:58:54.763Z
gate: save
updatedAt: 2026-07-08T01:58:54.763Z
---

codex exec --print blocks forever reading from stdin after writing the prompt. Claude CLI tolerates closed stdin fine. Fix: when using promisify(execFile) or similar, keep a reference to child.stdin and call stdin?.end() immediately after writing the prompt. --ephemeral prevents session files from accumulating (recommended). This was verified with a live codex exec call during development.

Related: [[council-multi-engine-architecture]]
