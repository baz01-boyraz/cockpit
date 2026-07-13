---
schema: 2
name: hermes-release-checklist
title: Next release checklist for the current Hermes worktree
class: reference
capturedAt: 2026-07-06T00:00:00.000Z
gate: asked
updatedAt: 2026-07-06T00:00:00.000Z
status: archived
authority: legacy
scope: project
confidence: low
firstSeenAt: 2026-07-06T00:00:00.000Z
reviewAfter: 2026-07-13T05:20:43.982Z
---

Before the next release, treat the current dirty worktree as a protected checkpoint problem, not a cleanup problem. Do not use `git reset`, `git clean`, `git checkout --`, broad stash operations, or `git add .` while preserving the Hermes integration state.

Release checklist:

- [ ] Audit read-only first: `git status --short`, `git diff --stat`, and `git diff --check`.
- [ ] Verify the untracked Hermes files are intentionally included: `src/assets/hermes/avatar.png`, `src/lib/hermesMarkup.tsx`, and the new `.cockpit-memory/*.md` notes.
- [ ] Run the minimum verification set before committing: `npm run typecheck`, `npm run lint`, and `npm test`.
- [ ] If UI changed, smoke-test the Hermes widget manually or capture a screenshot: launcher, expanded panel, send flow, error state, new conversation, image attach/paste/drop.
- [ ] Stage deliberately by group, never with `git add .`.
- [ ] Prefer separate commits for runtime/backend Hermes changes, Hermes widget/UI changes, and memory/docs notes. If the diff is too interwoven, make a single checkpoint commit first, then refactor in later commits.
- [ ] Before every commit, inspect `git diff --cached --stat` and `git diff --cached --check`.
- [ ] Keep the key invariants intact: Hermes controls cockpiT via the narrow MCP tool set, `run_checks` remains allowlist-only, chat runs without `--ignore-rules`, memory distill keeps redaction before Hermes, and self-initiated findings use `propose_swarm_card` rather than opening cards directly.

Related: [[hermes-mcp-architecture]], [[hermes-chat-backend]], [[self-initiated-card-protocol]], [[release-tagging-gotcha]]
