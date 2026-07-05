# cockpiT Logo And Icon Plan

Date: 2026-07-04

Scope: current cockpiT app visual audit for logo, app icon, sidebar icons, action icons, empty-state icons, and release assets. This file is a production brief for generating assets with GPT Image 2.0, then converting the chosen results into final SVG/PNG/ICNS assets.

## User Taste Notes And Rejected Directions

Updated after live logo/image-generation rounds on 2026-07-04.

Important identity facts:

- Product name is exactly **cockpiT**. Do not call it "Baz Cockpit" and do not design a B/Baz identity.
- The logo lives alone in the top-left rail area above the project switcher and dashboard tabs.
- The current design quality is already high; the logo must raise the whole app from about 8/10 to 9.5/10.
- The logo should feel native to the existing app, not like a separate generated brand pasted onto it.
- The user strongly rejected all generic/logo-sheet explorations so far. Avoid repeating those directions.

Rejected logo directions:

- **C + terminal prompt + circular cockpit/radar mark**: looked generic, crypto/VPN/devtool-template, and not compelling.
- **Glossy macOS app tile with C orbit or prompt arrow**: too expected and not ownable.
- **Abstract sci-fi/faction marks**: looked like gaming guild, spaceship, wings, or esports identity.
- **Flat node/diagram marks**: looked like dashboard diagrams, architecture icons, or feature illustrations rather than a premium logo.
- **Literal molten T core**: too much like a game item or fantasy/sci-fi badge; too literal and not sophisticated.
- **Command constellation in generated form**: still read as diagram/icon, not brand.
- **Logo sheets without app context**: misleading. Future logo exploration should show the candidate in the actual top-left rail slot.

Rejected prompt/style patterns:

- Do not ask for broad "premium abstract logo explorations"; generators drift into gaming/sci-fi.
- Do not center the concept on the letter C, terminal `>`, code brackets, shield, robot, rocket, wings, radar circle, or crypto coin.
- Do not overuse molten orange glow; the app already has strong ember moments.
- Do not create a busy miniature scene. The slot is small and surrounded by dense UI.

Current learning:

- Logo generation should be treated as **in-context product identity design**, not standalone logo art.
- Best next direction should probably be either a very restrained custom word/letter treatment for cockpiT or an in-app-prototyped SVG mark tested directly in the rail.
- For icons, generated concept sheets can help, but final icons should be simplified into local 24x24 `currentColor` SVG components.

## Product Read

cockpiT is a project-aware AI coding cockpit. The UI is not a generic SaaS dashboard; it is a dark, machined, execution-first developer cockpit where terminals, git, approvals, memory, swarm agents, usage, and deploy signals are visible in one operating surface.

Existing visual language:

- Theme: Molten Obsidian.
- Base: deep obsidian chrome and canvas.
- Brand warm: ember/copper for attention, primary action, Claude, live signals.
- Brand cool: glacier/cyan for Codex, data, info.
- Signal lime: safe/go only.
- Typography: system UI, with Space Grotesk reserved for brand wordmark moments.
- Icon style in code: 24px grid, monoline SVG, `currentColor`, 1.7px stroke, round caps/joins, minimal geometry.
- Logo slot today: `src/components/LeftRail.tsx` renders a 40x40 molten rounded tile with a lowercase `c` placeholder in `.rail__logo`.
- Current package assets: no real app icon in `resources/`; only `resources/entitlements.mac.plist`. Existing bitmap assets are Claude/Codex usage logos only.

Key design rule: the logo can be rich and dimensional, but the product icons should stay crisp, simple, and stroke-based so they work at 13-18px in the rail and buttons.

## Main Recommendation

The original "C aperture + prompt" recommendation below was tested and rejected. Do not reuse it as a primary direction.

Previous rejected direction:

**A compact cockpit/command mark: an obsidian rounded-square app tile containing a molten ember command aperture, shaped from a subtle `C` orbit and terminal prompt angle, with one small glacier counter-signal.**

Why it failed:

- It leaned into the most obvious developer-logo tropes.
- It became a C/terminal/radar badge instead of a memorable cockpiT identity.
- It looked decent in isolation but did not level up the actual left rail.

Better next working hypothesis:

**Design the logo inside the actual rail slot first. Favor restraint, silhouette, and native fit over conceptual cleverness. The logo may need to be prototyped directly in SVG/CSS rather than generated as a logo board.**

Avoid:

- Literal airplane cockpit, steering wheel, helmet, rocket, robot head, generic AI sparkles.
- Big "CT" monogram unless it remains abstract and readable at 16px.
- Too much orange glow; current UI already has strong ember attention.
- Thin details that disappear in the 40x40 rail slot.
- Any mark that looks like a game badge, faction crest, crypto app, architecture diagram, or generic AI/devtool logo.

## Asset Map

| Area | Current state | What should exist | Priority |
|---|---|---|---|
| Left rail brand | 40x40 molten tile with lowercase `c` | Real app mark inside the existing tile, or a finished tile replacing the CSS placeholder | P0 |
| macOS Dock icon | Not present in `resources/` | 1024x1024 app icon, exported to `.icns` | P0 |
| Window/app title identity | Text title only | Small mark + wordmark lockup for docs/release, optional in-app future use | P1 |
| Favicon/browser preview | No favicon in `index.html` | 32x32 and 16x16 simplified mark | P1 |
| Update toast | Uses generic bolt icon | App/update glyph or app mark variant | P2 |
| Left rail nav | Custom monoline icons already exist | Refined consistent icon pack for 9 nav items plus Notepad | P0 |
| Terminal controls | Generic bolt/restart/grid/focus | Action icon pack, same stroke system | P1 |
| Git review/local run | Shield-search, server, beaker, upload, cloud | Keep concept but refine for clarity and pixel alignment | P1 |
| Memory/Swarm empty states | Existing feature icons in large icon tile | Larger feature emblems derived from same pack | P1 |
| Usage engine strip | Claude/Codex bitmap logos | Keep provider logos; do not replace with generic icons | Keep |
| Release/GitHub image | None found | Optional 1200x630 social/release card using logo + Molten Obsidian background | P2 |

## Logo Production Brief

### Required Logo Outputs

- `logo-master.svg`: vector source, transparent background.
- `logo-tile-1024.png`: finished macOS app icon source.
- `logo-rail.svg` or `logo-rail.png`: optimized for 40x40 rail slot.
- `favicon-32.png`, `favicon-16.png`: simplified mark.
- `wordmark-horizontal.svg`: mark + `cockpiT` text, Space Grotesk style.
- `wordmark-light.svg`: for dark backgrounds.
- `wordmark-monochrome.svg`: one-color fallback.
- `resources/icon.icns`: generated from final 1024 source for Electron/macOS.

### Logo Prompt: Primary Direction

Status: **rejected after testing**. Keep only as a record of what not to repeat.

```text
Design a premium macOS app icon and logo mark for "cockpiT", an AI coding cockpit for senior developers.

Style: molten obsidian, machined dark glass, premium developer tool, calm but powerful. Create a rounded-square app tile with deep obsidian black surfaces, subtle bevels, and a restrained molten ember copper light. The central symbol should be abstract, not literal: combine a cockpit instrument aperture, a subtle letter C orbit, and a terminal prompt angle into one simple mark. Add one tiny glacier-cyan counter-signal to suggest the dual AI engines Claude and Codex.

The mark must read clearly at 16px, 32px, 40px, 128px, and 1024px. Use bold simple geometry, not thin filigree. No robot, no airplane, no rocket, no generic sparkles, no text inside the icon. Premium, restrained, high contrast, transparent-safe silhouette, centered, balanced.

Color palette: obsidian black #0a0b10, raised dark metal #15151d, molten ember copper #e0703a, amber highlight #ffb254, glacier cyan #62bedd used only as a small secondary accent.

Output: generate 4 variations in a single sheet, each on a neutral dark background, showing the full 1024 app icon plus a tiny 40px preview under it.
```

### Logo Prompt: More Abstract Mark

Status: **rejected after testing**. Broad abstract prompts pushed the model into gaming/sci-fi faction marks.

```text
Create an abstract vector-style brand mark for "cockpiT", a dark AI developer cockpit app.

The symbol should feel like a command aperture: a circular cockpit gauge, a terminal prompt, and a subtle C-shaped orbit fused into one minimal glyph. It should be recognizable as a standalone mark without text. Use molten ember copper on obsidian, with a tiny glacier cyan data spark as secondary accent.

Keep it simple enough for a 24px sidebar logo and strong enough for a macOS Dock icon. Avoid literal cockpit drawings, aircraft, robots, chat bubbles, code brackets, and busy circuitry. No words or letters except a very subtle abstract C form. Rounded geometry, precise optical balance, premium dark developer-tool aesthetic.

Produce: black/transparent version, ember-on-dark version, monochrome version, and app-icon tile version.
```

### Logo Prompt: Wordmark Lockup

Use after a mark direction is chosen.

```text
Create a horizontal wordmark lockup for "cockpiT" using the selected abstract cockpit command mark.

Text: cockpiT exactly, lowercase "cockpi" and uppercase final "T". The wordmark should feel like Space Grotesk or a similar geometric premium display face, with tight but readable spacing. The final T can carry a subtle molten ember treatment, but the full word must remain clean and readable.

Place the mark on the left, text on the right. Design for a dark obsidian app background. Provide versions: full color, white/ember, and monochrome. No slogan, no extra text, no mockup background, no 3D letters.
```

### Logo Critique Checklist

Before accepting a logo:

- At 16px, can we still recognize a unique silhouette?
- At 40px in the left rail, does it look better than the current `c` tile?
- Does it still feel like a developer cockpit, not a crypto/game logo?
- Does the ember stay premium and restrained, not a big orange blob?
- Does it avoid competing with the Claude/Codex engine logos at the rail bottom?
- Can it work as flat SVG if the dimensional app icon is too rich?
- Does it preserve the product name `cockpiT` without making the capital T gimmicky?

## Icon Pack System

The UI already has a good SVG convention. New/generated icons should be converted to this:

- 24x24 viewBox.
- 1.7px stroke.
- Round caps and joins.
- No fills unless play/stop/pause require filled controls.
- Use `currentColor`; color comes from CSS.
- Fit 13px, 15px, 17px, 20px usage.
- Avoid inner details below 2px gaps.
- Each icon should have a clear silhouette when dimmed in the rail.

Icon generation learning from the first generated sheet:

- Concept quality was better than logo generation, but the output was too illustrative.
- Generated icons must be simplified aggressively before use.
- Rail icons should not include color accents in the source asset; CSS state should provide color.
- Avoid feature-illustration density, tiny panels, tiny dots, glow, 3D, and colored internals.
- Target max 4-6 strokes/shapes per icon for nav glyphs.

Preferred icon workflow:

1. Generate concept sheet only for metaphor exploration.
2. Pick any useful metaphors.
3. Rebuild final icons manually as local 24x24 React SVG components.
4. Test at actual rail size: 17px inactive, active ember, hover, and badge-adjacent.

### Master Icon Pack Prompt

Use this to generate the full pack as a sheet.

```text
Design a cohesive monoline icon pack for a premium dark AI developer cockpit app called cockpiT.

Style: 24x24 grid, 1.7px stroke feel, rounded caps, rounded joins, no filled backgrounds, no text labels inside icons, simple geometric forms, optimized for 13-18px UI use. Icons should feel like machined cockpit instrument glyphs: precise, calm, technical, not playful. Use a neutral light stroke on dark background for preview. Do not use gradients in the icons. Do not make them 3D. Do not make them filled app icons.

Create icons for these names:
Dashboard, Terminals, Git, Swarm Board, Railway Deploy, Logs And Errors, Project Memory, Usage Dashboard, Settings, Notepad, Branch, Search, Approval Shield, Warning, Upload Push, Download Pull, Restart, Cloud Connect, Server, Test Beaker, AI Bolt, Review Shield Search, Council Lenses, Play, Stop, Pause, Focus Mode, Grid Mode, Auto Layout, Image Attachment, Send, Copy, Check, Close, Folder, Plus.

Visual metaphors:
Dashboard = four cockpit panels or instrument tiles.
Terminals = terminal window with prompt.
Git = branch graph with nodes.
Swarm Board = three kanban lanes with agent cards, not insects.
Railway Deploy = rail/deploy track or service platform, not a train toy.
Logs And Errors = stacked log lines with alert cue.
Project Memory = connected knowledge nodes, triangle or graph.
Usage Dashboard = bar chart or quota gauge.
Settings = precise gear or calibration dial.
Notepad = small notebook with side binding.
Approval Shield = shield with check.
Review Shield Search = shield plus magnifier.
Council Lenses = overlapping lenses/persona views.

Output as a clean grid on dark background, each icon centered in its cell, consistent stroke weight and optical size.
```

### Navigation Icon Pack Prompt Only

Use if we want one focused batch just for the left rail.

```text
Create a focused left-sidebar navigation icon set for cockpiT, a premium AI coding cockpit.

Make 10 icons: Dashboard, Terminals, Git, Swarm Board, Railway, Logs And Errors, Memory, Usage, Settings, Notepad.

Style: 24x24 monoline SVG-ready glyphs, 1.7px stroke, rounded caps and joins, no fill, no gradients, no text, optimized for 17px display in a dark left rail. The icons should look like quiet cockpit instrument symbols. Keep them distinct from each other: Dashboard is tiled instruments, Terminals is a prompt window, Git is branch nodes, Swarm is kanban lanes, Railway is deploy/service rail, Logs is horizontal lines plus alert cue, Memory is connected knowledge nodes, Usage is quota bars/gauge, Settings is calibration dial, Notepad is bound notebook.

Preview them in a single grid with enough spacing and a dark obsidian background.
```

### Navigation Icon Pack Prompt: Refined Minimal Round

Use this after rejecting illustrative/generative icon sheets.

```text
Create a refined left rail icon pack for cockpiT.

These are not illustrations. They are tiny product navigation glyphs for a desktop app sidebar.

Hard constraints:
- must work at 17px
- 24x24 SVG icon grid
- only 1.7px monoline stroke
- no color accents except preview can use light gray stroke
- no cyan
- no orange details
- no internal panels with charts
- no large enclosing frames
- no tiny dots that disappear
- no labels
- no 3D
- no glow
- no filled shapes
- no complex diagrams
- each icon should use max 4-6 strokes/shapes

Create exactly 10 icons in a 5x2 grid:
Dashboard, Terminals, Git, Swarm, Railway, Logs, Memory, Usage, Settings, Notepad.

Metaphors:
Dashboard = 4 uneven instrument tiles.
Terminals = terminal window with prompt.
Git = 3 branch nodes.
Swarm = 3 vertical kanban lanes.
Railway = deployment track/service platform, not train.
Logs = 4 log lines plus tiny warning cut.
Memory = 3 connected knowledge nodes.
Usage = simple bar chart plus small arc.
Settings = calibration dial, not sun.
Notepad = bound notebook.

Output only the icons on a dark background. Make them minimal, elegant, and consistent with each other.
```

## Specific Icon Notes By Surface

### Left Rail

Files: `src/components/LeftRail.tsx`, `src/components/icons.tsx`, `src/components/notepadIcons.tsx`.

Needed:

- Dashboard: existing 2x2 tile icon is fine. Could become more "instrument panel" with mixed tile heights.
- Terminals: existing prompt window works. Keep this as one of the most literal icons.
- Git: existing branch graph works. Make node spacing clearer at 17px.
- Swarm: existing kanban lanes are a good non-literal metaphor. Do not use insect/swarm imagery.
- Railway: current train-like icon risks feeling too literal. Better: service rail/platform/deploy track.
- Logs & Errors: current plain log lines are weak. Add subtle alert marker or broken line cue.
- Memory: current triangle graph is good. For product character, make it feel like knowledge constellation, not git branch.
- Usage: existing bar chart is okay. Could become gauge/bar hybrid to match quota rings.
- Settings: current sun/gear-like icon is acceptable but should feel like calibration dial.
- Notepad: current notebook is good and separate. Bring into shared pack if doing a full refresh.

Prompt for Railway replacement:

```text
Design a 24x24 monoline icon for "Railway deploy/service" in a developer cockpit app. It should suggest deployment tracks, service routing, and infrastructure platform, not a cute train. Use simple rail lines, platform nodes, or a service route. 1.7px rounded stroke, no fill, no text, readable at 17px.
```

Prompt for Logs replacement:

```text
Design a 24x24 monoline icon for "Logs and Errors" in a developer cockpit app. Combine stacked log lines with a subtle alert cue, but keep it calm and technical. 1.7px rounded stroke, no fill, no text, readable at 17px in a dark sidebar.
```

### Dashboard

Files: `src/panels/DashboardPanel.tsx`.

The dashboard uses icons for changed files, terminals, agents, Railway, approvals, recent errors, and launch CTAs. These should not feel like a second icon style. Best move: reuse rail icons for stat tiles, use action icons only in buttons.

Needed:

- AI launch icon should not always be generic lightning. Claude and Codex can share "AI engine" but color differentiates them. If possible, create two engine glyph variants: warm engine core and cool engine core.
- Approval icon should stay shield-first.
- Error icon should stay warning triangle but can become more refined.

Prompt for AI engine icon:

```text
Design a 24x24 monoline "AI engine launch" icon for a premium developer cockpit. It should suggest power, command execution, and an AI engine core without using a generic sparkle or robot. Simple angular bolt/core geometry, 1.7px rounded stroke, no fill, no text, readable at 14px.
```

### Terminals

Files: `src/panels/TerminalsPanel.tsx`, `src/components/TerminalView.tsx`.

Terminals are the execution layer. The terminal icon is one of the most important product glyphs after the logo.

Needed:

- Terminal rail icon.
- Empty-state terminal emblem in a 56-64px tile.
- Blank shell, dev server, Claude, resume Claude, Codex actions.
- Focus, grid, auto layout.
- Kill, restart, close.
- Image attachment and stream indicator.

Prompt for terminal emblem:

```text
Create a larger empty-state emblem for "Terminals" in cockpiT. It should be based on a simple terminal prompt window icon, but more polished for a 64px feature tile. Dark obsidian tile, tiny molten ember prompt, restrained glow pool, no text, no mascot, premium developer cockpit style.
```

### Git And Review

Files: `src/panels/GitPanel.tsx`, `src/components/ReviewFindings.tsx`, `src/components/CouncilVerdict.tsx`.

Needed:

- Git branch.
- Push/upload, pull/download.
- Force-push shield.
- GitHub cloud connect.
- Local dev server.
- Tests/beaker.
- AI diff review shield-search.
- Council lenses.

The review shield-search and council lenses are brandable feature icons; they can be slightly more distinctive than basic action icons.

Prompt for review feature icon:

```text
Design a 24x24 monoline icon for "AI diff review" in a developer cockpit. Combine a security shield with a magnifier or inspection lens. It should feel like pre-ship code review and safety, not antivirus. 1.7px rounded stroke, no fill, no text, readable at 13px and 18px.
```

Prompt for council icon:

```text
Design a 24x24 monoline icon for "AI reviewer council". Show three overlapping lenses or viewpoints reviewing the same change. Avoid people heads, chat bubbles, or committee imagery. Precise geometric 1.7px rounded stroke, no fill, readable at small UI sizes.
```

### Swarm

Files: `src/panels/SwarmPanel.tsx`, `src/components/swarm/*`.

Swarm is an agent Kanban/worktree surface, not an insect metaphor. Keep it as lanes/cards/agent routing.

Needed:

- Swarm board rail icon.
- Empty-state swarm emblem.
- Card start/play, park/pause, done/check, terminal link, branch/worktree, review, council.
- Column watermark icon.

Prompt:

```text
Design a 24x24 monoline icon for "Swarm Board" in an AI developer cockpit. It should show multiple kanban lanes with small agent cards or routing tracks. Do not use insects, bees, dots-as-bugs, or biological swarm imagery. 1.7px rounded stroke, no fill, no text, readable at 17px.
```

### Memory

Files: `src/panels/MemoryPanel.tsx`, `src/components/memory/*`.

Memory is a living project brain built from markdown notes, wikilinks, graph connections, and review/save flows.

Needed:

- Memory rail icon.
- Living brain bar icon.
- Empty-state project memory emblem.
- Create note, save, discard, search, close.

Current memory icon (triangle connected nodes) is conceptually correct. For logo/icon pack, make it slightly more organic as a knowledge graph but not a brain drawing.

Prompt:

```text
Design a 24x24 monoline icon for "Project Memory" in a developer cockpit. It should suggest a living knowledge graph made of connected markdown notes. Use three to five connected nodes, precise geometry, no brain illustration, no database cylinder, no text. 1.7px rounded stroke, readable at 17px.
```

### Usage

Files: `src/panels/UsagePanel.tsx`, `src/components/UsageStrip.tsx`.

Usage uses provider identity heavily. Claude and Codex logos are already strong bitmap assets and should remain. Product icons around usage should be neutral.

Needed:

- Usage rail icon.
- Sessions, commands, agent tasks, estimated tokens.
- Quota/gauge icon if needed.

Prompt:

```text
Design a 24x24 monoline icon for "Usage Dashboard" in a developer cockpit. It should combine quota tracking, bars, and a cockpit gauge feel. No currency symbol, no generic analytics chart only. 1.7px rounded stroke, no fill, no text, readable at 17px.
```

### Logs And Errors

Files: `src/panels/LogsPanel.tsx`.

Needed:

- Logs rail icon.
- Detect/AI insight icon.
- Warning/error icon.
- Send to AI icon.
- Dismiss/close.

The Logs rail icon should become stronger because it currently reads like generic horizontal lines.

### Right AI Panel And Chat Launcher

Files: `src/components/RightPanel.tsx`, `src/components/AppShell.tsx`.

The right panel is behind `CHAT_ENABLED`; when enabled, the launcher uses a bolt. This should eventually be a cockpit/AI command glyph, not the same bolt used for every action.

Needed:

- AI cockpit launcher.
- Engine picker caret.
- Attachment image.
- Send.
- Copy.
- Approval shield in route cards.

Prompt:

```text
Design a 24x24 monoline icon for "AI Cockpit" launcher. It should feel like opening a command cockpit or AI engine panel. Avoid chat bubble, robot, magic sparkle, and generic lightning. Use precise cockpit aperture plus command cue. 1.7px rounded stroke, no fill, readable at 20px.
```

### Notepad

Files: `src/components/NotepadLauncher.tsx`, `src/components/NotepadDrawer.tsx`, `src/components/notepadIcons.tsx`.

Notepad already has a separate local icon file with matching conventions. Keep the notebook metaphor, but include it in the final icon audit so it does not drift.

Needed:

- Notebook launcher.
- Pin.
- Trash.
- Search.
- Spark/empty state.
- Close.

## Implementation Notes After Assets Are Chosen

Likely code/file changes later:

- Replace `.rail__logo > span` placeholder in `src/components/LeftRail.tsx` with imported logo asset or inline SVG component.
- Add final app icon files under `resources/`, likely `resources/icon.icns` plus source PNGs if desired.
- Add favicon files under `public/` and link them in `index.html`.
- If generated icons are adopted, convert them into React SVG components in `src/components/icons.tsx` and `src/components/notepadIcons.tsx`.
- Preserve `currentColor` for UI glyphs; do not import colored bitmap icons for nav/action icons.
- Keep Claude/Codex provider bitmap logos in `src/assets/usage/` unchanged unless replacing with official updated assets.

## Final Deliverable Checklist

- [ ] Choose 1 logo direction from GPT Image 2.0 output.
- [ ] Test chosen logo at 16, 24, 32, 40, 128, 1024.
- [ ] Create final vector mark and app tile.
- [ ] Export macOS `.icns`.
- [ ] Export favicon sizes.
- [ ] Generate focused nav icon pack.
- [ ] Convert accepted icons to SVG components.
- [ ] Screenshot left rail, dashboard, terminals empty, git review, memory empty, usage.
- [ ] Verify icons look consistent in inactive, active, hover, and accent states.
