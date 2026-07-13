---
schema: 2
name: git-bootstrap-flow
title: GitHub/Railway auth is global; new one-click repo bootstrap added
class: architecture
capturedAt: 2026-07-05T20:45:48.665Z
gate: save
updatedAt: 2026-07-06T05:36:01.274Z
status: active
authority: legacy
scope: project
confidence: low
firstSeenAt: 2026-07-05T20:45:48.665Z
reviewAfter: 2026-10-11T05:20:43.983Z
---

cockpiT never stores GitHub/Railway tokens itself — GitHubService and RailwayService both shell out to the global `gh`/`railway` CLI, so auth is machine-wide and shared across ALL projects (not per-project, nothing to 're-connect' when starting a new project). The old 'Connect GitHub' button in GitPanel was misleading in a fresh, un-gitted folder: it just re-ran `gh auth login` (a no-op since you're already authed) and did nothing to init git or create/attach a repo — there was no `git init` / `gh repo create` flow anywhere in the codebase. Fixed in v0.1.38 (commit 3bffdf6): added `GitService.initRepo()` (git init + HEAD->main, no-op if already a repo) and `GitHubService.createRepo()` (`gh repo create --source=. --remote=origin`, does NOT push), new IPC channels `git:initRepo`/`github:createRepo` with Zod schemas + mock.ts parity, and GitPanel now branches three ways: no repo/remote -> new 'Create GitHub repo & attach' form (name + private/public, one click); remote exists but auth broken -> real Connect GitHub button; remote exists but non-GitHub -> info only.

Related: [[ipc-contract]]
- (2026-07-06) GitHub and Railway auth is global via machine-level `gh`/`railway` CLI — cockpiT never stores tokens itself, so there is nothing to 're-connect' per project. The old 'Connect GitHub' button was misleading in a fresh, un-gitted folder: it only re-ran `gh auth login` (a no-op when already authed) and did nothing to init git or create/attach a remote — there was no `git init`/`gh repo create` flow anywhere in the codebase. Fixed in v0.1.38: added `GitService.initRepo()` (git init + HEAD->main, no-op if already a repo) and `GitHubService.createRepo()` (`gh repo create --source=. --remote=origin`, no push), new IPC channels `git:initRepo`/`github:createRepo` with Zod schemas + mock.ts parity, and GitPanel now shows a 'Create GitHub repo & attach' form (name + private/public toggle) when no repo/remote exists, vs the real Connect GitHub button when auth is actually broken, vs info-only when a non-GitHub remote exists.
- (2026-07-06) GitPanel Pull button is hardcoded `disabled` with no `onClick` handler; tooltip says "Pull will be wired after push execution approvals." No `GitService.pull()` method exists, no `gitPull` IPC handler is registered. This is a conscious design decision to defer pull until the push-approval flow is settled, not a bug or regression. Refresh, Push, and Force-push buttons work correctly.
