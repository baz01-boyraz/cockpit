# Diff Review

Pre-ship AI review (Phase 4). The sanitizer IS the feature: sensitive paths
excluded by name, every line through redaction (see [[security-enforcement]]),
budgets with visible truncation, injection suspects flagged independently of
the model, per-run random fence with the untrusted-data rule.

Dogfood story worth remembering: on its first real run against this repo, the
feature **found a bug in its own freshly-written UI** — a blocked-only change
set (e.g. a lone `.env` edit) never reaches the model, yet the panel showed the
green "ship it". Fix: ship-it requires `filesReviewed > 0`. Moral: dogfood
before declaring a gate passed.

Operational notes: sonnet sometimes answers in prose → parser degrades to a
visible raw block (never silent); output contract is restated at the prompt
tail; CLI timeout 360s. The per-block review action in the terminal reuses the
same boundary via `review.runText` — blocks come from the app-level store
(Phase 3.1), the seam [[swarm-design]] reviewer roles will reuse.
