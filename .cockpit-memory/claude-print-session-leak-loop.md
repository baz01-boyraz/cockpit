---
schema: 1
name: claude-print-session-leak-loop
title: Self-feeding memory-capture loop silently burns Claude quota
class: gotcha
capturedAt: 2026-07-06T02:29:02.888Z
gate: save
updatedAt: 2026-07-06T03:19:25.922Z
---

MemoryAutoCapture (90s interval) and ReviewService (swarm gate6 code-review) spawn `claude --print` with `cwd: project.path`. `--print` is NOT stateless — each call writes a `.jsonl` transcript into `~/.claude/projects/<project>/`. ClaudeSessionsService.list() treats every `.jsonl` in that dir as a real session with no origin filter. MemoryAutoCapture's next sweep picks up these auto-generated transcripts as 'grown sessions' and re-distills them, creating yet more `.jsonl` files. One file had 6 nested copies of the distiller prompt. CaptureQueue dedup is by session_id, but each automated call creates a brand-new id, so dedup never fires. Fixed by adding `--no-session-persistence` to `buildClaudeArgs` in `shared/claude-run.ts` — automated calls still get full project context (cwd, CLAUDE.md) but never write transkript files to disk, breaking the loop at its root.

Related: [[usage-billing-model]], [[memory-distiller-cli-only]], [[memory-reconcile-dedup-gotcha]]
- (2026-07-06) Originally the memory distiller used the local claude CLI to run distillation. This consumed Claude Code's per-reset quota on every session exit, starving the actual coding tool. Switched to hermes --ignore-rules --oneshot via OpenRouter/DeepSeek at ~$0.01/session instead. The --ignore-rules flag is intentional — prevents Hermes from loading AGENTS.md and its orchestrator persona for this mechanical call.
