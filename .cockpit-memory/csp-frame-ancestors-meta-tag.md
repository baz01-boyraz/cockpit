---
schema: 1
name: csp-frame-ancestors-meta-tag
title: CSP frame-ancestors dropped from meta-tag delivery
class: gotcha
capturedAt: 2026-07-05T04:01:10.032Z
gate: asked
updatedAt: 2026-07-05T19:26:32.640Z
---

electron.vite.config.ts PROD_CSP no longer includes `frame-ancestors 'none'`. Reason: frame-ancestors (like sandbox, report-uri/report-to) is ignored by browsers when delivered via a <meta> tag — only valid as an HTTP response header — so keeping it just emitted a harmless console error. Claimed compensating control is that the Electron window isn't embeddable by remote origins anyway, but that enforcement (if any) lives elsewhere (e.g. webContents navigation/setWindowOpenHandler) and wasn't shown in this diff — unverified whether it actually exists. No test guards CSP meta contents.

Related: [[security-enforcement]]
- (2026-07-05) electron.vite.config.ts PROD_CSP dropped the `frame-ancestors 'none'` directive because CSP is only ever injected via a <meta> tag (transformIndexHtml) — no onHeadersReceived/HTTP-header CSP exists anywhere in cockpiT. frame-ancestors is only honored on an HTTP response header per spec, so it was silently non-functional via meta and only emitted a console error. If CSP delivery ever moves to a real HTTP header (e.g. via onHeadersReceived), re-add frame-ancestors 'none' there since it will then actually be enforced.
- (2026-07-05) Council review of the frame-ancestors removal (electron.vite.config.ts) added detail beyond 'it's a no-op in <meta>': (1) the correct fix is header-based CSP via `session.defaultSession.webRequest.onHeadersReceived` in the main process, where frame-ancestors actually works — not documented as a follow-up anywhere; (2) the 'not embeddable by remote origins, so moot' claim ignores that the localhost screenshot workflow (`node serve.mjs` serving `out/renderer` on :3000, used every UI review round per CLAUDE.md) serves this exact built HTML as plain HTTP with zero anti-framing header, a real iframe-embeddable surface; (3) no regression test guards against the directive silently reappearing broken or the gap going unnoticed.
