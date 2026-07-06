---
schema: 1
name: git-bootstrap-flow
title: GitHub/Railway auth is global; new one-click repo bootstrap added
class: architecture
capturedAt: 2026-07-05T20:45:48.665Z
gate: save
updatedAt: 2026-07-05T20:45:48.665Z
---

cockpiT never stores GitHub/Railway tokens itself — GitHubService and RailwayService both shell out to the global `gh`/`railway` CLI, so auth is machine-wide and shared across ALL projects (not per-project, nothing to 're-connect' when starting a new project). The old 'Connect GitHub' button in GitPanel was misleading in a fresh, un-gitted folder: it just re-ran `gh auth login` (a no-op since you're already authed) and did nothing to init git or create/attach a repo — there was no `git init` / `gh repo create` flow anywhere in the codebase. Fixed in v0.1.38 (commit 3bffdf6): added `GitService.initRepo()` (git init + HEAD->main, no-op if already a repo) and `GitHubService.createRepo()` (`gh repo create --source=. --remote=origin`, does NOT push), new IPC channels `git:initRepo`/`github:createRepo` with Zod schemas + mock.ts parity, and GitPanel now branches three ways: no repo/remote -> new 'Create GitHub repo & attach' form (name + private/public, one click); remote exists but auth broken -> real Connect GitHub button; remote exists but non-GitHub -> info only.

Related: [[ipc-contract]]
