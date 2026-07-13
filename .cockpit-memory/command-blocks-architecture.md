---
schema: 2
name: command-blocks-architecture
title: Command Blocks shell integration + TUI suppression
class: architecture
capturedAt: 2026-07-04T22:57:14.832Z
gate: asked
updatedAt: 2026-07-05T03:44:14.170Z
status: active
authority: legacy
scope: project
confidence: low
firstSeenAt: 2026-07-04T22:57:14.832Z
reviewAfter: 2026-10-11T05:20:43.983Z
---

Command Blocks capture is pure/resumable and lives in shared/ (CommandStreamSplitter + CommandBlockModel + dependency-free ansi-to-html, 256-color). Shell integration injects OSC 133 markers: zsh via env, bash via --rcfile using a DEBUG-trap approach kept macOS bash-3.2 compatible; fish/pwsh are intentionally a graceful no-op (plain scrollback fallback) because they require live-shell verification. TUI/alt-screen suppression pauses block capture while claude/vim/pager draw full-screen so one fullscreen app can't inflate a giant block; output and block counts are capped (MAX_BLOCKS).

Related: [[bridgespace-roadmap]]
- (2026-07-05) Command Blocks capture logic is pure and resumable, in shared/ (CommandStreamSplitter + CommandBlockModel + dependency-free ansi-to-html, 256-color) so it stays runtime-dep-free and unit-testable. Shell integration injects OSC 133 markers: zsh via env, bash via --rcfile with a DEBUG-trap approach kept macOS bash-3.2 compatible. fish/pwsh are an intentional graceful no-op (plain scrollback fallback) because they need live-shell verification. TUI/alt-screen suppression pauses block capture while claude/vim/pager draw full-screen so one fullscreen app can't inflate a giant block; output length and block count are capped (MAX_BLOCKS).
