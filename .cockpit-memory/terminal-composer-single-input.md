---
schema: 2
name: terminal-composer-single-input
title: Terminal composer is the ONE writing place — xterm typing reroutes into it
class: architecture
capturedAt: 2026-07-13T01:18:06.000Z
gate: save
updatedAt: 2026-07-13T01:18:06.000Z
status: active
authority: legacy
scope: project
confidence: low
firstSeenAt: 2026-07-13T01:18:06.000Z
reviewAfter: 2026-10-11T05:20:43.983Z
---

Baz rejected two input surfaces per terminal ('2 tane ayri yazma yeri bana igrenc geliyor'). Since commit c9e5812 the composer is the only text input: `shouldRouteKeyToComposer` (shared/terminal-ux.ts) reroutes printable keydowns from xterm into the composer; Enter/arrows/Ctrl/Cmd chords stay terminal-native for TUI menus, and alternate-screen apps (vim, htop) bypass routing entirely. Both keydown AND keypress must be swallowed or xterm still writes to the pty. Text paste over the xterm host reroutes too. Images no longer auto-send an absolute-path line — they stage as composer chips and ride the next message as `Attached image: <relativePath>` (absolute path only for shell role, which may have cd'd away). Symptom that means this is working, not broken: clicking the terminal and typing moves focus to the composer.

Related: [[terminal-memory-contract]], [[prompt-dock-text-modification-rejected]]
