---
schema: 1
name: molten-obsidian-design
title: Molten Obsidian visual system and product wordmark
class: architecture
capturedAt: 2026-07-04T20:42:41.082Z
gate: save
updatedAt: 2026-07-12T05:03:45.000Z
---

# Molten Obsidian

cockpiT uses a role-based color triad on an obsidian ground with a strict accent budget (roughly 90/7/2/1 and at most three ember attention points per view):

- Ember / `--molten` marks the pilot's attention and primary actions.
- Glacier marks machine data and Codex identity; Claude remains ember.
- Lime means safe/go.

This solved “ember fatigue,” where making everything orange destroyed the accent's meaning. Each view region gets at most one resting glow. The core/pool/trace primitives and signature motions—glint, count-up, masked conic hover ring, and one-shot toast bloom—animate transform/opacity only and honor `prefers-reduced-motion`. The complete contract lives in `docs/DESIGN-VISION.md` and `docs/DESIGN.md` (base system commit `20a77dd`).

## Wordmark and dashboard

Space Grotesk is the premium wordmark face. It is self-hosted at `public/fonts/space-grotesk-latin.woff2`; the CSP intentionally does not depend on Google Fonts. Dashboard hero and left rail use the same molten “cockpit” wordmark. The hero title is the product name, while active-project context lives in `COMMAND CENTER · <project>`, the top bar, and the project switcher.

The redundant HeroEngines block was removed because usage already exists in the rail and Usage view. The hero therefore uses a quieter two-column identity/CTA layout. The rail pairs its wordmark with a copper monogram and restrained developer capsule (v0.1.35, `a35dac1`).

## Durable exceptions

- Raised graph controls use `--surface-3`; `--bg-raised` is not a defined token.
- Hermes-specific avatar, input, and send accents use platinum/white to match the Hermes ring identity rather than borrowing the general ember CTA color.

Related: [[diff-review]], [[bundled-display-font]], [[brand-mark-gauge-needle]]
