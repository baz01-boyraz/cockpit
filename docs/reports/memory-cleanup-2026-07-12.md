# One-time memory cleanup — dry-run report

Status: completed. The dry-run version was committed before any live note rewrite; results below were added only after verification.

## Safety checkpoint

- Snapshot: `2026-07-12T05-01-41-495Z-6b8a3a5c`
- Snapshot scope: all 126 top-level project-memory notes
- Restore location: `.cockpit-memory/.snapshots/2026-07-12T05-01-41-495Z-6b8a3a5c/`
- Starting size: 208,006 UTF-8 bytes
- No cleanup finding is fed back into Capture/Distill or saved as a new memory observation.

## Dry-run result

- 66 repeated fact candidates across 9 notes.
- 4 notes above the 8 KB soft size ceiling.
- 0 whole-note duplicate pairs.
- 11 unresolved wikilink targets existed before cleanup; they are a two-brain/navigation concern, not cleanup authorization.

| Memory | Starting bytes | Repeated fact candidates | Planned action |
| --- | ---: | ---: | --- |
| `named-agents-team` | 29,077 | 23 | Replace repeated capture history with one current architecture summary and the few durable transitions. |
| `swarm-design` | 20,528 | 16 | Keep load-bearing architecture and one canonical entry per lifecycle/design decision. |
| `diff-review` | 11,068 | 8 | Keep the sanitizer contract, two-surface coupling, stale-project guard, and current Hermes routing once each. |
| `molten-obsidian-design` | 7,371 | 5 | Keep one current visual contract plus genuinely distinct exceptions. |
| `bridgespace-roadmap` | 3,748 | 4 | Remove repeated roadmap statements while preserving milestones and rationale. |
| `memory-hub` | 5,379 | 3 | Collapse repeated pipeline/store descriptions into one current fact. |
| `app-refresh-autoupdate-revert` | 2,199 | 3 | Keep one canonical update/revert rule. |
| `security-enforcement` | 6,849 | 2 | Remove repeated policy prose without weakening any security boundary or verbatim gotcha. |
| `memory-ux-overhaul` | 2,424 | 2 | Keep one current UX contract and its acceptance rationale. |

## Apply guardrails

1. Preserve every unique decision, reason, failure symptom, commit/version reference that is still needed, and all frontmatter.
2. Remove only repeated historical captures; do not infer new facts or resolve contradictions by recency.
3. Do not delete or archive any note in this pass. If a future pass needs removal, it must use soft-delete.
4. Compare wikilink targets before and after. Cleanup must introduce zero new unresolved targets and must not remove a unique target without an explicit replacement.
5. Re-run the deterministic report after edits, then run memory tests, typecheck, lint, and the production build.

## Approval basis

This is a one-time cleanup explicitly requested by the owner. The dry run and snapshot make the operation bounded and recoverable; the actual rewrite remains a separate, reviewable git commit.

## Verified result

- Notes: 126 → 126; no note was deleted or archived.
- Hub size: 208,006 → 136,505 UTF-8 bytes (71,501 bytes / 34% smaller).
- Repeated fact candidates: 66 → 0.
- Notes above the 8 KB soft ceiling: 4 → 0.
- Whole-note duplicate pairs: 0 → 0.
- Existing unresolved targets: unchanged at 11; no new unresolved target was introduced.
- Removed wikilink targets: 0. One additional link to the existing `brand-mark-gauge-needle` note was added.
- Restore snapshot remains available under the safety-checkpoint path above.
