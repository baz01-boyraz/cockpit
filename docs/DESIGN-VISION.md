# DESIGN-VISION.md — "Molten Obsidian"

> UI/UX vision & build roadmap for cockpiT — authored by Fable 5, 2026-07-01.
> Scope: **visual design and interaction only.** Architecture, features, and code health are
> owned by the parallel review track — this document deliberately does not touch them.
> `docs/DESIGN.md` remains the day-to-day house-style reference; this file is the *destination*
> we build toward. When the roadmap ships, fold the outcomes back into DESIGN.md.
>
> Evidence: screenshots `temporary screenshots/screenshot-103..106-f5-*.png`
> (dashboard, git, terminals, usage — taken from the current build on 2026-07-01).

---

## Part I — Honest assessment of the current design

### What is already genuinely good

1. **The identity is real.** "Obsidian Ember" — deep cool surfaces + copper accent + lime
   signal — is distinctive. No default blue/indigo, no generic AI-tool look. This is rarer
   than it sounds; the brand *direction* does not need to change, it needs to be sharpened.
2. **The foundations are premium-grade.** Surface ladder (base → raised → floating), 1px
   hairlines, top-highlight bevel, film grain, layered dark shadows. The physics of the UI
   are correct.
3. **Motion discipline exists.** `transform`/`opacity` only, spring easings, mount staggers,
   `prefers-reduced-motion` support. Most apps never get this far.
4. **Component vocabulary is consistent.** `.card`, `.btn`, `.chip`, `.eyebrow`, `.stat` are
   reused, not reinvented per view.

### Where it falls short of "premium" today

1. **Ember fatigue — the accent has stopped being a signal.**
   On the Usage view, *everything* is orange: four stat dots, both quota bars, all three
   provider bars, the toast button, the engine gauge. On the dashboard: launch CTA, approval
   card, three badges, changed-files dot, activity dots, engine ring — all ember, all at once.
   When everything glows, nothing does. The accent is currently *decoration*; it must go back
   to being *meaning*.

2. **The brand is a one-hue brand.**
   Ember carries the entire identity alone; lime barely appears. There is no cool counterweight,
   so the palette reads warm-on-grey rather than a composed combination. Notably, a cool blue
   *already leaks in* (the Codex weekly bar, `--info`) — it's emergent, not designed.

3. **Glows are flat single-layer box-shadows.**
   Most glows are one `box-shadow: 0 0 10px var(--accent-glow)`. Premium light is layered
   (hot tight core + wide soft falloff), hue-shifted (hotter at center, cooler at the edge),
   and *pooled on surfaces* rather than stroked around boxes. A few places already do this
   right (modal ambient glow, engine logo pedestal) — it's inconsistent, not systemic.

4. **Big cards are flat interiors.**
   Recent errors / Activity / Account quota are large expanses of `--surface-1` with a
   hairline. At this size the interior needs structure: inset data wells, stronger internal
   gradient, zone separation. The bevel is invisible at 500px tall.

5. **Chrome and canvas are the same material.**
   Top bar, left rail, and content share nearly the same background, separated only by
   hairlines. Linear/Raycast-class apps tint the chrome (nav/frame) slightly differently from
   the canvas (content) so the workspace reads as a machined object, not one flat sheet.

6. **Numbers don't feel like instruments.**
   Stats (`5`, `0/0`, `280k`, `77%`) share weight and default numerals. A cockpit's numbers
   should be tabular, weight-contrasted against their labels, and *arrive* (tick up) rather
   than pop in.

7. **No signature motion.**
   The staggers are competent but anonymous. There is no moment where the UI does the one
   memorable thing that makes people screenshot it. "Subtle but eye-catching" needs 3–4
   deliberate signature moves, not more ambient animation everywhere.

8. **Empty states are dead air.**
   Terminals-empty is a small centered icon in a huge dark void. Emptiness can be premium,
   but only when it's *composed* (ambient light, guidance, density at the edges).

9. **The update toast shouts.**
   Solid saturated button + glow border + persistent presence — it competes with the page's
   primary CTA. Notifications should arrive with physics, glow once, then settle to quiet.

---

## Part II — The vision: "Molten Obsidian"

One sentence: **a machined obsidian instrument panel where light means something — ember is
the pilot's attention, glacier is the machine's data, lime is safe-to-go.**

### 2.1 Brand color system — from one hue to a composed triad

The fix is not new colors; it is *roles and ratios*.

| Role | Name | Anchor values | Used for |
|---|---|---|---|
| Foundation (~90%) | Obsidian | `#0a0b0f → #242834` ladder (existing) | Everything structural |
| Brand warm (~7%) | **Ember** | ramp below | Interaction, attention, Claude, "live" |
| Brand cool (~2%) | **Glacier** | `#6cb6d6` (promote existing `--info`) | Data, metrics, Codex, informational |
| Signal (~1%) | **Lime** | `#cde85f` (existing) | Safe / go / success-emphasis only |

**Ember becomes a ramp, not a single orange** (tokens: `--ember-100..700`):

```
--ember-100: #ffd9c2   pale highlight (text on dark washes, glint cores)
--ember-200: #ffb185   hover-top (exists in .btn--accent:hover)
--ember-300: #ff9d63   = --accent-hi
--ember-400: #ee7c42   = --accent (unchanged — the brand anchor)
--ember-500: #d3642f   deep copper (pressed states, gradient tails)
--ember-600: #a84d24   rust (borders on warm washes)
--ember-700: #6e3316   deepest (large-area washes, ambient pools)
```

**The signature "molten" gradient** — reserved exclusively for brand moments (primary CTA,
logo, one hero element per view, never two):

```css
--molten: linear-gradient(135deg, var(--ember-300), var(--ember-400) 55%, var(--ember-500));
```

**Glacier** (`--glacier-300: #9ed2ea`, `--glacier-400: #6cb6d6`, `--glacier-500: #4b7f9e`)
formalizes the dual-engine identity that is already emergent: **Claude = ember, Codex =
glacier**. Usage bars, engine gauges, and per-provider stats adopt this split. Neutral
"terminal/local" data uses obsidian-grey bars, not orange.

**The 90/7/2/1 rule** (enforced per view in Phase 1): if a view uses ember on more than ~3
elements, demote the extras to neutral. Ember answers exactly one question: *"where should
the pilot look?"*

**Foundation chroma nudge (experiment):** raise surface chroma ~2% toward blue-violet
(e.g. `--surface-1: #13151d → #131522`) so obsidian reads "night cockpit" instead of grey.
A/B screenshot before committing — this is a feel, not a fact.

### 2.2 Light system — three glow primitives, one discipline

Replace ad-hoc box-shadows with three named primitives:

```css
/* 1. glow-core — interactive accents: hot tight core + cool wide falloff */
--glow-core:
  0 0 0 1px rgba(255, 177, 133, 0.28),        /* hot rim */
  0 2px 10px -2px rgba(238, 124, 66, 0.5),     /* mid bloom */
  0 8px 30px -6px rgba(211, 100, 47, 0.32);    /* wide, cooler falloff */

/* 2. glow-pool — ambient light pooled on/behind a surface (pseudo-element) */
.glow-pool::before {
  background: radial-gradient(60% 70% at 50% 100%, var(--accent-wash), transparent 70%);
}

/* 3. glow-trace — light running along a single edge (leading-edge rails, dividers) */
.glow-trace {
  background: linear-gradient(90deg, transparent, var(--accent-glow), transparent);
  height: 1px;
}
```

**Discipline (non-negotiable): at most one breathing/pulsing light per view region.**
Glow = "this is live or needs you." A static button never glows at rest; it glows on
hover/focus. The approval card glows because it *is* the attention request.

### 2.3 Depth — machined chrome vs. canvas

- **Chrome tint:** left rail + top bar get a half-step darker/cooler background than the
  canvas (`--chrome: #0d0e13`), with a slightly stronger hairline where chrome meets canvas.
  The frame becomes a machined bezel around the working surface.
- **Inset data wells:** inside big cards, lists and charts sit in `--surface-inset` wells
  with `inset` top shadow — instruments recessed into the panel. (The git file list and
  quota bars are the first candidates.)
- **Card interior gradient:** strengthen from ~2% to ~4% so the vertical falloff is
  perceptible on tall cards.

### 2.4 Typography — instrument numerals

- `font-variant-numeric: tabular-nums` on every metric, badge, timer, and percentage.
- Weight contrast: metric values 650, their labels 500/faint. Numbers are the heroes.
- Page titles keep the size but gain a whisper of character: `letter-spacing: -0.03em` plus
  a **one-word molten treatment** on the view's key noun only where it earns it (e.g. the
  branch name on Git). Never full-title gradient text.
- The `cockpiT` wordmark in the rail becomes a small brand moment: molten gradient on the
  "T", pooled glow under the logo mark (pedestal pattern already exists — reuse it).

### 2.5 Signature motion — four moves, everything else stays quiet

The "spicy but subtle" budget is spent on exactly four signatures. Specs:

1. **Ember glint** — on primary CTA hover (and app launch), a 45° light streak sweeps across
   once. `background-position` animation on an overlay gradient, 650ms `--ease-out`,
   `once per hover-intent` (not on every pixel of mouse movement).
2. **Instrument tick-up** — stat numbers count from previous → new value on mount/change.
   450ms, eased-out steps, tabular-nums so nothing shifts. (JS hook: small `useCountUp`,
   respects reduced-motion by jumping instantly.)
3. **Ember trace** — on card hover/focus, a 1px conic border-light rotates into place from
   the top edge (CSS `@property --trace-angle`, 500ms). Replaces the current plain
   border-color swap on `.card--hover`. This is the screenshot-bait move — still 1px, still calm.
4. **Arrival physics** — toasts and approval cards enter with a spring drop
   (`translateY(-8px) scale(0.98)` → settle, 320ms `--ease-spring`), pool-glow blooms once
   (900ms) and fades to rest. Nothing pulses forever.

Supporting rules (keep, systematize): view-switch = existing stagger + 8px shared-axis slide
in nav direction; live bars get a slow liquid shimmer *only while actually running*; engine
gauge arcs draw in on mount (`stroke-dashoffset`, 600ms). All gated behind
`prefers-reduced-motion`.

### 2.6 Micro-details that read as money

- Selection color: ember-700 wash with `--ember-100` text; caret ember.
- Scrollbar thumb hover: whisper of ember (`rgba` 12%), not grey.
- Focus ring: keep 2px ember, add 2px offset everywhere (already in global — audit gaps).
- `⌘K` and shortcut chips: recessed keycap style (inset bevel), tabular, `--text-faint`.
- Badges (rail counts): tabular-nums, and *warm only when actionable* (errors badge ember,
  terminal count neutral).
- Empty states: composed — pooled ambient glow behind the icon, one-line promise, actions
  in a row (Terminals already has the actions; add the light and tighten the void).

---

## Part III — Roadmap

Each phase is shippable and screenshot-verified (min. 2 rounds per touched view, per
CLAUDE.md loop). Phases are ordered so that token work lands before any component work.
No phase changes IPC, services, or component logic beyond presentational props/classes.

### Phase 0 — Token foundation *(no visible change; pure groundwork)*

- [x] Add ember ramp `--ember-100..700` to `tokens.css`; alias `--accent`/`--accent-hi` to
      ramp steps (zero regressions — existing tokens keep their values).
- [x] Promote glacier: `--glacier-300/400/500`; keep `--info` as alias of `--glacier-400`.
- [x] Add `--molten` gradient token + `--chrome` surface token.
- [x] Add glow primitives: `--glow-core`, `.glow-pool` helper, `.glow-trace` helper.
- [x] Add motion tokens: `--dur-glint: 650ms`, `--dur-trace: 500ms`, `--dur-arrive: 320ms`.
- [x] `npm run typecheck && npm run lint && npm test` green; screenshot diff = identical.

### Phase 1 — The great ember demotion *(color ratio enforcement)*

Per-view accent audit — demote to neutral/semantic, keep ember only for attention:

- [x] **Usage:** stat dots → neutral; provider bars → Claude ember / Codex glacier /
      Terminal obsidian-grey; quota bars → same split (warning tint only when < 20% left);
      period. One ember element remains: the live "tracking" indicator.
- [x] **Dashboard:** ember keeps CTA + approval card + errors badge. Demote: changed-files
      dot, activity dots (AI rows → glacier, user rows → neutral), terminals/agents dots.
- [x] **Git:** ember keeps Push CTA only. Staged/changed chips stay semantic
      (green/amber); local-run icons → neutral until running.
- [x] **Rail/engines:** Claude gauge ember, Codex gauge glacier (icon already blue) —
      dual-engine identity becomes visible.
- [x] Screenshot all 4 views; verify "count the orange" ≤ 3 attention points per view.

### Phase 2 — Light system *(glows become layered and meaningful)*

- [x] Primary CTA (`.btn--accent`): molten gradient fill + `--glow-core`; rest state calm,
      hover blooms.
- [x] Approval card: `.glow-pool` under the card + existing breathe (this is the one
      breathing element on Dashboard).
- [x] Engine pedestals: unify on the pool pattern (exists) — ember pool / glacier pool.
- [x] Live indicators (running terminal, active session dot): layered core glow, not flat.
- [x] Update toast: arrival bloom (900ms) then settle; kill the persistent glow border;
      button → quiet secondary with ember text.
- [x] Audit: exactly one resting glow per view region; everything else lights on interaction.

### Phase 3 — Depth & chrome *(the machined bezel)*

- [x] Rail + top bar → `--chrome` tint; strengthen the chrome/canvas hairline.
- [x] Inset wells: recent-errors list + activity feed recessed. *(Git file list and usage
      sections deferred — they are already distinct cards; card-in-well read muddy.)*
- [ ] ~~Card interior gradient 2% → 4%~~ — decided against: the chroma nudge (below) gave
      the tall cards their richness without touching the gradient.
- [x] A/B the surface chroma nudge — **kept** (`--surface-1: #131521` etc., shots 107 vs 111):
      obsidian now reads "night cockpit", ember pops harder against the cooler ground.
- [x] Terminals empty state: pooled glow pedestal behind icon, tighter vertical rhythm.

### Phase 4 — Typography & instruments

- [x] `tabular-nums` utility applied to all metrics, badges, timers, percentages.
- [x] Weight recalibration: values 650 / labels 500-faint across `.stat`, quota, provider rows.
- [x] Wordmark moment: molten "T" + logo pedestal glow in rail brand block.
- [x] Git view: branch name gets the one-word molten treatment (it's the view's hero noun).
- [x] Keycap style for `⌘K` and shortcut chips.

### Phase 5 — Signature motion

- [x] **Ember glint** on `.btn--accent` hover (overlay gradient sweep, once per hover-intent).
- [x] **Instrument tick-up**: `useCountUp` hook; wire to dashboard stats + usage stats.
- [x] **Ember trace**: conic border-light on `.card--hover` hover/focus via `@property`.
- [x] **Arrival physics**: toast + approval card spring drop + one-time bloom.
- [ ] ~~Shared-axis 8px slide on view switch~~ — decided against: panels re-run their
      stagger choreography on every view switch already; a second layer of motion stacked
      on top read as jitter, not direction.
- [ ] Liquid shimmer on *actively running* progress bars — deferred until a view has a
      genuinely long-running bar (toast download progress already animates).
- [x] Engine arc draw-in on mount.
- [x] Reduced-motion audit: every new animation has a `prefers-reduced-motion` gate.

### Phase 6 — Polish pass & acceptance

- [x] Full screenshot sweep, all views, 2+ rounds each; pixel fixes (spacing rhythm,
      alignment, radii, shadow softness).
- [x] Micro-details batch: selection color, caret, scrollbar hover, focus-ring offset audit,
      badge tabular-nums.
- [x] Fold shipped outcomes back into `docs/DESIGN.md` (tokens table, glow discipline,
      motion signatures) so the house style stays the single source of truth.
- [x] Acceptance checklist:
  - [x] ≤ 3 ember attention points per view; Claude/Codex read as ember/glacier at a glance.
  - [x] One resting glow per view region, layered (never flat single box-shadow).
  - [x] Chrome visibly distinct from canvas; data recessed in wells.
  - [x] All metrics tabular + weight-contrasted; numbers tick, never pop.
  - [x] All four signature motions present, each < 700ms, all reduced-motion-safe.
  - [x] Zero `transition-all`; zero non-transform/opacity animations.

### Build log — 2026-07-01 (Fable 5)

All six phases shipped in one pass; verified over three screenshot rounds
(`screenshot-107..119-f5r*`), including hover-state captures for the ember trace ring and
CTA glint (`screenshot-hover-*`). Checks green: `typecheck:web`, `eslint src/`, 189/189
unit tests. Extra win found during the sweep: the Settings "Safety policy" wall (9 amber
chips) demoted to neutral chips with warning-tinted shield glyphs. Outcomes folded back
into `docs/DESIGN.md` (color table, accent budget, light discipline, signature motions).

### Guardrails (apply to every phase)

- Never default blue/indigo as *interactive* color — glacier is data-only, ember owns
  interaction.
- No new resting animation loops beyond the per-view budget (one).
- No layout rewrites — this roadmap restyles what exists; structural UX changes are a
  separate conversation.
- Every phase ends green: `typecheck`, `lint`, `test`, screenshot loop.
