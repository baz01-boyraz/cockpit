# Security Enforcement

Phase 1's lesson: a documented guarantee is not a guarantee — the gate must
live in the main process, never in UI convention.

- Destructive actions consume a single-use approval: `ApprovalService.consume()`
  verifies project + action + status atomically, then spends it. The `guarded()`
  wrapper in `registerIpc.ts` is the one door; every future mutating handler
  goes through it (see [[ipc-contract]]).
- Redaction lives in `shared/redaction.ts`: vendor patterns + bare `*_KEY`
  names + a high-entropy env fallback. `redactText()` scrubs terminal lines
  before anything is persisted. [[diff-review]] reuses it line-by-line.
- "Rebuild & relaunch" only ever targets cockpiT's own source
  (`isCockpitSource`: package identity, not a script-name string match).
- Verified live against the real app with an isolated profile
  (`--user-data-dir` + remote debugging) — the pattern for all live E2E since.
