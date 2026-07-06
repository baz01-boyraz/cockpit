---
schema: 1
name: security-enforcement
title: CSP frame-ancestors dropped from meta-tag CSP
class: gotcha
gate: save
updatedAt: 2026-07-06T01:17:47.037Z
---

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
- (2026-07-05) `frame-ancestors` was removed from PROD_CSP in electron.vite.config.ts because it is a no-op when the CSP is delivered via a <meta> element — the directive is only honored on an HTTP response header, so keeping it just produced a harmless console warning. Electron's window isn't embeddable by remote origins anyway, so top-level frame-ancestors protection is moot here. Do not re-add frame-ancestors to the meta-based CSP; if real HTTP-header-based CSP delivery is ever introduced, reconsider it there.
- (2026-07-05) electron.vite.config.ts's PROD_CSP intentionally omits `frame-ancestors 'none'` — that directive is only honored via HTTP response headers, not a <meta> CSP tag, so including it there just logs a harmless console error with zero protective effect. Top-level frame-ancestors is also moot since the Electron window isn't embeddable by remote origins. Don't re-add it to the meta-tag CSP.
- (2026-07-05) electron.vite.config.ts's PROD_CSP array has no regression test (confirmed no *csp* test file exists), unlike the redaction and force-push-gate suites CLAUDE.md marks as release blockers. Open TODO: grep the full PROD_CSP array for other meta-tag-ignored directives (sandbox, report-uri, report-to) that may already be silently dead the same way frame-ancestors was, and add a test asserting the built index.html's CSP meta content matches the expected directive set.
- (2026-07-05) Confirmed via repo search (LLM council review, 2026-07-05): there is no session.defaultSession.webRequest.onHeadersReceived or any other header-based CSP delivery anywhere in electron/main — the strictCspPlugin meta-tag swap in electron.vite.config.ts is the ONLY CSP delivery mechanism in the app. This forecloses 'just move frame-ancestors to a header-based CSP' as the fix — that would be new scope, not a response to the existing setup. If header-based CSP is ever introduced for other reasons, frame-ancestors should be reconsidered there (per existing note).
- (2026-07-05) electron.vite.config.ts's PROD_CSP dropped the `frame-ancestors 'none'` directive. CSP in this app is delivered exclusively via a <meta http-equiv="Content-Security-Policy"> tag (strictCspPlugin's transformIndexHtml regex swap into index.html), never via session.defaultSession.webRequest.onHeadersReceived — and frame-ancestors is spec-ignored when delivered via <meta>, only valid as an HTTP response header, so it was just emitting a harmless console warning. Not a real security regression since there's no other frame-ancestors enforcement in the app. No test exists for PROD_CSP content, so a future edit could silently loosen script-src/connect-src with nothing catching it.
- (2026-07-05) `electron.vite.config.ts` dropped the `frame-ancestors 'none'` directive from PROD_CSP (was ~line 21) with a comment explaining it's a no-op when delivered via <meta> tag (spec-accurate — meta CSP ignores frame-ancestors). But the comment only documents the gap instead of closing it: the correct fix is header-based CSP via `session.defaultSession.webRequest.onHeadersReceived` in the main process, where frame-ancestors actually works. Also unaddressed: the localhost screenshot workflow (`node serve.mjs` serving `out/renderer` on :3000, used every UI review round per CLAUDE.md) serves this exact built HTML as plain HTTP with no anti-framing header at all — a real embeddable-by-iframe surface the removal comment dismissed as 'moot'.
- (2026-07-05) electron.vite.config.ts removed the `frame-ancestors 'none'` CSP directive instead of fixing its delivery. Root cause: frame-ancestors (like sandbox/report-uri) is spec-ignored when delivered via a <meta> tag — only an HTTP response header honors it, so it was a no-op emitting a console error. Correct fix is to inject it as a real header via `session.defaultSession.webRequest.onHeadersReceived`, not delete the directive. Deleting narrows the security surface with no test pinning expected CSP directives, so a future edit could silently drop script-src/object-src too.
- (2026-07-05) Confirmed via repo search (LLM council review, 2026-07-05): there is no session.defaultSession.webRequest.onHeadersReceived or any other header-based CSP delivery anywhere in electron/main — the strictCspPlugin meta-tag swap in electron.vite.config.ts is the ONLY CSP delivery mechanism in the app. This forecloses 'just move frame-ancestors to a header-based CSP' as the fix — that would be new scope, not a response to the existing setup. If header-based CSP is ever introduced for other reasons, frame-ancestors should be reconsidered there (per existing note).
- (2026-07-06) The `frame-ancestors` CSP directive is explicitly ignored by browsers when delivered via a `<meta>` element — it only takes effect as an HTTP response header. During a CSP cleanup in electron.vite.config.ts, the `frame-ancestors 'none'` directive was removed from the meta-tag CSP because it emitted console errors with no actual protective benefit. Electron windows aren't embeddable by remote origins anyway, so omitting it is safe. If frame-ancestors enforcement is needed, it must be set as an HTTP header, not in a meta tag.
- (2026-07-06) Confirmed via repo search (LLM council review, 2026-07-05): there is no session.defaultSession.webRequest.onHeadersReceived or any other header-based CSP delivery anywhere in electron/main — the strictCspPlugin meta-tag swap in electron.vite.config.ts is the ONLY CSP delivery mechanism in the app. This forecloses 'just move frame-ancestors to a header-based CSP' as the fix — that would be new scope, not a response to the existing setup. If header-based CSP is ever introduced for other reasons, frame-ancestors should be reconsidered there (per existing note).
