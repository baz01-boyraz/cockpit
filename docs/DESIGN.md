# Design Guide — cockpiT

A project-local design guide so future sessions can apply the visual system without
re-deriving it. This is the cockpit's "house style." When in doubt, match what already ships.

## Personality

Serious, fast, premium, useful. A cockpit a senior engineer trusts. **No fake dashboard slop** —
every visible metric or control must help the user decide or act. Calm by default; the ember
accent is reserved for the few things that matter (primary action, live signal, attention).

## Color (tokens in `src/styles/tokens.css`)

| Role | Token | Value |
|---|---|---|
| Background (deep graphite, not pure black) | `--bg` | `#0b0c0f` |
| Raised graphite | `--surface-1` | `#14161c` |
| Warm charcoal | `--surface-2` | `#1a1d25` |
| Floating | `--surface-3` | `#222631` |
| Text (warm off-white) | `--text` | `#ece6da` |
| Muted (stone) | `--text-muted` | `#9a9488` |
| **Accent — ember/copper** | `--accent` | `#e07b45` |
| Secondary — signal lime (safe/go) | `--signal` | `#c4e35a` |
| success / warning / danger | … | restrained, semantic |

**Never** default Tailwind blue/indigo. The accent is copper; lime means "safe/read-only."

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
