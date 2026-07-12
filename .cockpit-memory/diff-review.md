---
schema: 1
name: diff-review
title: Pre-ship review sanitizer and shared review surfaces
class: architecture
gate: asked
updatedAt: 2026-07-12T05:03:45.000Z
---

# Diff review

The sanitizer is the trust boundary: sensitive paths are excluded by name, every line passes through [[security-enforcement]] redaction, budgets truncate visibly, injection suspects are detected independently of the model, and each run uses a random fence plus an explicit untrusted-data rule.

Two entry surfaces share that boundary and `ReviewFindings` renderer:

- GitPanel “Review before ship” calls `review.run` over staged, unstaged, and allowed untracked changes.
- BlocksView calls `review.runText` for a captured command and its output.

Non-obvious coupling: `isInjectionFinding` applies the warm warning style when a finding title contains `prompt-injection`. A model-authored title can therefore look sanitizer-detected, so sanitizer wording and future provenance UI must keep that distinction explicit. `parseFindings` tolerates fenced JSON, a `{ "findings": [...] }` root, uppercase severities, and numeric-string line numbers; invalid prose degrades to a visible raw block rather than disappearing.

Project switches are a trust boundary too. Any in-flight review that closes over `activeProjectId` must be cancelled or discarded after the active project changes, otherwise an old project's result can silently populate the new project's panel.

Current routing: `ReviewService` invokes Hermes with `--ignore-rules` for this bounded mechanical analysis. The old Claude-specific model selector was removed from GitPanel. Council and chat routing are separate concerns.

Dogfood invariant: the first real repo run found that a blocked-only change set (for example only `.env`) reached no model but the UI still showed green “ship it.” Ship-it now requires `filesReviewed > 0`. A safety gate is not complete until exercised against its own edge cases.

Operationally, the output contract is repeated at the prompt tail and the CLI timeout is 360 seconds. Swarm reviewer roles reuse this injectable runner seam; see [[swarm-design]].

Related: [[security-enforcement]], [[swarm-design]]
