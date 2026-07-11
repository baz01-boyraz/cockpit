---
schema: 1
name: hermes-copy-testing-hover-reveal
title: Playwright hover-reveal copy button needs explicit hover before click
class: gotcha
capturedAt: 2026-07-06T05:55:04.442Z
gate: save
updatedAt: 2026-07-06T05:55:04.442Z
---

When testing the copy button (which is revealed on hover via CSS transition on .hermes__msg--hermes:hover), a direct Playwright .click() on the button can time out because the hover-reveal transition hasn't completed before the click arrives. The fix: perform an explicit hover on the parent message element first, then click the button. This affects any UI test targeting hover-reveal elements with CSS transitions.

Related: [[hermes-copy-hover-reveal]]
