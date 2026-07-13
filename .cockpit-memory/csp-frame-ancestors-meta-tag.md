---
schema: 2
name: csp-frame-ancestors-meta-tag
title: CSP frame-ancestors silently ignored via meta tag
class: gotcha
capturedAt: 2026-07-06T01:17:21.243Z
gate: asked
updatedAt: 2026-07-06T01:17:21.243Z
status: active
authority: legacy
scope: project
confidence: low
firstSeenAt: 2026-07-06T01:17:21.243Z
reviewAfter: 2026-10-11T05:20:43.983Z
---

CSP directives frame-ancestors, sandbox, report-uri, and report-to are all silently ignored by browsers when delivered via a <meta> element — only HTTP response headers enforce them. During work on electron.vite.config.ts, frame-ancestors 'none' was removed from the meta-tag-delivered CSP with a comment documenting this. The project's CSP is currently meta-tag-delivered via the Vite strictCspPlugin, which means any of these directives added there will be a silent no-op. If full CSP enforcement is ever needed, it must be moved to Electron's session.defaultSession.webRequest.onHeadersReceived in the main process.

Related: [[security-enforcement]]
