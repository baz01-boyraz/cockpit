# Vision Journey

The master execution roadmap lives in `docs/cockpit-VISION.md` — 7 phases, each
with a gate. This note is the running narrative; the phase notes carry the
transferable knowledge.

Shipped so far: [[security-enforcement]] (Phase 1), [[ipc-contract]] (Phase 2),
state/lifecycle groundwork (Phase 3), [[diff-review]] (Phase 4), and
[[memory-hub]] (Phase 5 — the feature these notes live in).

Next: [[swarm-design]] (Phase 6) — the orchestrator service, Kanban-driven
agents, resume on the reconciled terminal rows.

Working rhythm that got us here: plan doc before code, TDD for every pure
kernel, security boundary before wiring, agents for parallel fan-out, live
dogfood before calling a gate passed.
