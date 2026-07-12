---
schema: 1
name: security-enforcement
title: Main-process security gates and meta-CSP boundary
class: gotcha
gate: save
updatedAt: 2026-07-12T05:03:45.000Z
---

# Security enforcement

A documented guarantee is not a guarantee: enforcement belongs in the main process, not in renderer convention.

- Destructive actions consume a single-use approval. `ApprovalService.consume()` atomically verifies project, action, and status, then spends the approval. `guarded()` in `registerIpc.ts` is the IPC door for protected mutations; see [[ipc-contract]].
- `shared/redaction.ts` covers vendor tokens, bare `*_KEY` names, and high-entropy environment values. `redactText()` runs before terminal content is persisted, and [[diff-review]] reuses the same boundary line by line.
- Rebuild/relaunch may target only cockpiT's own source, verified by package identity rather than a script-name substring.
- Real-app security behavior is checked with an isolated profile (`--user-data-dir` plus remote debugging), which remains the preferred live E2E pattern.

## `frame-ancestors` evidence and open risk

`electron.vite.config.ts` delivers production CSP through a `<meta http-equiv="Content-Security-Policy">` transform. Browsers ignore `frame-ancestors` in meta CSP; it is honored only in an HTTP response header. The no-op directive was therefore removed because it produced a console warning without enforcing anything. Repository search found no `session.defaultSession.webRequest.onHeadersReceived` or other header-based CSP path. See [[csp-frame-ancestors-meta-tag]].

Do not re-add `frame-ancestors` to the meta array and mistake that for protection. If the threat model requires anti-framing—for example a separately served HTTP build/screenshot surface—it needs a real response header. Adding that delivery path is new security scope, not a cleanup of the existing meta tag.

Open regression gap: the full `PROD_CSP` directive set is not pinned by a focused test. A future change could weaken `script-src`, `object-src`, or `connect-src` silently; other meta-ignored directives should also be audited before being treated as effective.

Related: [[ipc-contract]], [[diff-review]], [[csp-frame-ancestors-meta-tag]]
