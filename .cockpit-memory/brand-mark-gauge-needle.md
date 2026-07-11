---
schema: 1
name: brand-mark-gauge-needle
title: Brand mark redesigned to gauge/needle + plain Cockpit wordmark
class: decision
capturedAt: 2026-07-05T19:07:46.137Z
gate: save
updatedAt: 2026-07-07T01:41:08.925Z
---

Replaced the old faceted-gem mark and split 'cockpi'/'T' wordmark with a gauge-needle mark and plain 'Cockpit' text everywhere (dock icon, rail, top bar, dashboard hero, splash screen), matching Baz's reference images (designmaster.png, logo-cockpit.png). Deliberately kept the macOS app bundle name as `cockpiT` (productName, /Applications/cockpiT.app) and internal docs/scripts unchanged — only visible logo/wordmark/window-title/menu-bar name changed, to avoid breaking auto-update chain and app:refresh targeting. Shipped in v0.1.37, commit 47b0e1d, CI built/signed/notarized/published successfully.

Related: [[molten-obsidian-design]], [[rail-logo-slot]], [[bundled-display-font]], [[app-refresh-consent-rule]]
- (2026-07-07) Using diagonal `linearGradient` on a small SVG gauge circle (56px) creates ugly banding/spottiness especially on short arcs at low fill percentages (~11%). Thick conic-gradient CSS mask hack with double filter stacking also produced a messy look. The working approach: thin full-circle resting hairline (always visible, same color family as fill but very muted), brighter fill arc on top, wide soft ambient glow bloom via `feGaussianBlur` + `feMerge` — Apple Watch activity ring style. No gradient on the stroke itself, only solid colors.
