# Design Guide — cockpiT

A project-local design guide so future sessions can apply the visual system without
re-deriving it. This is the cockpit's "house style." When in doubt, match what already ships.

## Personality

Serious, fast, premium, useful. A cockpit a senior engineer trusts. **No fake dashboard slop** —
every visible metric or control must help the user decide or act. Calm by default; the ember
accent is reserved for the few things that matter (primary action, live signal, attention).

## Color (tokens in `src/styles/tokens.css`) — "Molten Obsidian"

| Role | Token | Value |
|---|---|---|
| Background (night obsidian, subtle blue chroma) | `--bg` | `#0a0b11` |
| Raised obsidian | `--surface-1` | `#131521` |
| Lifted | `--surface-2` | `#1a1d2b` |
| Floating | `--surface-3` | `#242838` |
| Chrome (rail / machined bezel) | `--chrome` | `#0e1016` |
| Text (crisp cool white) | `--text` | `#f2f4f8` |
| Muted | `--text-muted` | `#a2a8b4` |
| **Brand warm — ember ramp** | `--ember-100..700` | anchor `--accent` = `#ee7c42` |
| **Brand cool — glacier** (data/Codex/info) | `--glacier-300/400/500` | anchor `#6cb6d6` |
| Molten gradient (brand moments ONLY) | `--molten` | ember 300→400→500 |
| Secondary — signal lime (safe/go) | `--signal` | `#cde85f` |
| success / warning / danger | … | restrained, semantic |

**The accent budget (enforced):** ember answers one question — *where should the pilot
look?* At most ~3 ember attention points per view; demote the rest to neutral. Glacier is
data-only, never interactive. Dual-engine identity: **Claude = ember, Codex = glacier**
(usage bars, quota dots, engine rings). **Never** default Tailwind blue/indigo.

### Light discipline

Three glow primitives, one rule: **at most one resting/breathing light per view region.**
- `--glow-core` — layered interactive light (hot rim + mid bloom + wide falloff); hover/focus only.
- pool — radial light pooled under an element (engine pedestals, logo, empty-state icons).
- trace — light running along one edge (active rail item, `.card--hover` ember trace ring).
A static control never glows at rest; glow means "live or needs you."

## Type

- System sans for UI (`--font-sans`), mono for code/paths/values (`--font-mono`).
- Tight tracking on large headings (`-0.03em`), comfortable body line-height (~1.55).
- Eyebrows: 10px, uppercase, `0.14em` tracking, faint — they label sections quietly.

## Depth & surfaces

Three-layer ladder: base → raised (`.card`) → floating (modals). Cards use a subtle vertical
gradient + a 1px hairline border (`--border`), not flat fills. Shadows are layered and dark
(`--shadow-1/2/float`) — never a flat `shadow-md`. The body has stacked radial gradients plus a
~3.5% SVG grain for tactile depth.

## Motion

- Animate **only** `transform` and `opacity`. Never `transition-all`.
- Spring easing (`--ease-spring`) for press/hover lift; `--ease-out` for fades.
- `fade-rise` on view/section mount; `pulse-dot` for live indicators. Keep it subtle.

### Signature motions (the whole "spicy" budget — don't add more ambient loops)

1. **Ember glint** — light streak sweeps `.btn--accent` once per hover (`--dur-glint`).
2. **Instrument tick-up** — stat numbers count up via `<CountUp>` (`src/components/CountUp.tsx`);
   pair with `tabular-nums`.
3. **Ember trace** — 1px conic border-light sweeps `.card--hover` on hover and settles at the
   top edge (registered `--trace-angle`).
4. **Arrival physics** — toasts spring in and bloom once (`toast-bloom`), then rest quiet.
Plus: engine quota rings draw in on mount (registered `--fill`). Everything gated behind
`prefers-reduced-motion`.

## Interactive states (required, no exceptions)

Every clickable element has hover, `:focus-visible` (2px ember ring), and active (`scale .97`).
Disabled = `.42` opacity + `not-allowed`. See `.btn`, `.chip`, `.rail__item`, `.tab` in
`src/styles/global.css` / `components.css`.

## Layout

Desktop-first 3-column shell: left rail (nav + project) · center (topbar + main) · right AI
panel. The top bar is a drag region (`-webkit-app-region`) with no-drag islands for controls.
Panels cap at ~1100px for readability except full-bleed views (terminals).

## Components to reuse

`.card` / `.card--hover`, `.btn` (+`--accent`/`--ghost`/`--danger`/`--sm`), `.chip`
(+`--accent`/`--success`/`--warning`/`--danger`), `.stat`, `.eyebrow`, `.mono`. Prefer composing
these over inventing new one-offs.

## Review loop

Build → `serve.mjs` → `screenshot.mjs` → read PNG → fix specific pixel issues → re-shoot.
Minimum two rounds. Check: spacing rhythm, font size/weight, exact colors, alignment, radii,
shadow softness, and that hover/focus states exist.
