# Sentinel decision cards — design QA

## Evidence

- Reference: `.dev-cockpit/attachments/2026-07-14T06-01-50-724Z-att_11ae06cfefcc47c9-Screenshot-2026-07-14-at-1.01.49-AM.png`
- Final full view (1280 × 720, bell popover open): `output/playwright/sentinel-decision/.playwright-cli/page-2026-07-14T15-43-26-211Z.png`
- Responsive checks: `output/playwright/sentinel-decision/.playwright-cli/page-2026-07-14T15-44-05-414Z.png` (1024 × 720) and `output/playwright/sentinel-decision/.playwright-cli/page-2026-07-14T15-44-31-593Z.png` (800 × 600)
- Focused source/implementation comparison: `output/playwright/sentinel-decision/source-vs-open-popover.png`
- State: Serbest Law project selected, recent-signals bell open, log-intelligence and approval cards visible.

## Comparison history

1. Initial open-popover pass exposed passive update/toast layers beneath the translucent popover. Fixed by making `.floatingCorner` yield while the recent-signals dialog is open.
2. The initial Dismiss treatment appeared disabled because its border and background were transparent. Fixed with the product's inset surface and standard border tokens.
3. Re-captured the same open-popover state after both fixes. Cards are unobstructed, actions are visually distinct, and the surrounding shell continues the reference's dark obsidian, warm orange, cool blue, rounded-chip language.

## Final review

- Typography: existing Cockpit font stack, sizes, weights, and hierarchy retained; no fallback or clipping observed.
- Spacing and geometry: card padding, chip gaps, action row, popover edges, and radii are consistent with existing tokens. No horizontal or vertical overflow at 1280, 1024, or 800 px.
- Color and contrast: importance, restart-required, no-restart, and unknown states are differentiated without relying on copy alone. Dismiss now reads as an available secondary action.
- Copy: every card contains a short issue summary, an importance percentage, a restart-impact label, Ask Claude, Ask Codex, and Dismiss.
- Assets: existing product icons and wordmark are reused; no placeholder or approximated assets were introduced.
- Layering: background update and toast surfaces are hidden while the bell popover is open, preventing bleed-through and accidental clicks.

## Interaction QA

- Bell opens and closes; passive floating notifications yield and return.
- Ask Claude opens a direct Claude terminal titled `Signal review`.
- Ask Codex opens a direct Codex terminal titled `Signal review`.
- Dismiss changes the signal to `Dismissed` and disables all three actions for that signal.
- Signal center navigation is covered by the Sentinel bell E2E flow.
- Browser console after the final interaction pass: 0 errors, 0 warnings.

Final result: passed.
