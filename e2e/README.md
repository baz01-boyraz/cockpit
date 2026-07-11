# E2E smoke suite

Playwright, headless Chromium only. Runs against the built renderer served on
localhost, exercising the app through its in-browser mock bridge
(`src/lib/mock.ts`) — the same setup CLAUDE.md documents for the screenshot
review workflow. No Electron process is involved.

## What's covered

Exactly seven journeys, on purpose — this is a smoke suite, not full coverage:

1. **Dashboard boot** (`01-dashboard-boot.spec.ts`) — rail, command-center
   hero, and the pending-approval banner all render on first load.
2. **Terminals** (`02-terminals-blocks.spec.ts`) — nav click renders the
   panel; spinning up a blank shell mounts the terminal surface (session
   tabs + the stream/blocks toggle).
3. **Swarm** (`03-swarm-create-card.spec.ts`) — open the board, create a
   card through the To-do column's inline composer, see it land.
4. **Memory** (`04-memory-create-note.spec.ts`) — open the hub (empty for
   the default seed project), migrate the legacy renderer trust choice into
   independent project/global policy, then save a human note under Manual mode
   without gate friction.
5. **Sentinel** (`05-sentinel-bell.spec.ts`) — the bell's unseen count, the
   mock's one-time toast replay, and the popover's signal list.
6. **Rail navigation** (`06-rail-navigation.spec.ts`) — daily work remains in
   the primary rail while lower-frequency utilities stay discoverable in the
   control center.
7. **Council copy/export** (`07-council-copy-export.spec.ts`) — Council text is
   selectable; primary, full-report, section, keyboard, and scoped context-menu
   copy paths work; Markdown export and scorecard placement remain correct.

## Running

```bash
npm run build          # fresh out/renderer — the suite does NOT rebuild for you
npm run test:e2e       # runs playwright.config.ts's webServer (node serve.mjs)
                        # against localhost:3000, reusing an already-running
                        # `npm run serve` if one is open
npx playwright show-report   # HTML report from the last run
```

Useful flags while iterating:

```bash
npx playwright test --headed             # watch it drive a real browser
npx playwright test --debug              # step through with the inspector
npx playwright test e2e/tests/03-swarm-create-card.spec.ts
npx playwright test --repeat-each=5      # flakiness check before trusting a spec
```

## Structure

```
e2e/
  support/app.ts        # gotoApp() — navigate past the boot splash; NAV map
  pages/*.page.ts        # thin Page Object Model wrappers, one per journey area
  tests/*.spec.ts         # the seven journeys, numbered for read order
```

Selectors prefer roles/aria-labels/visible text that already exist in the
components (e.g. `SwarmCard`'s `aria-label="Edit card: {title}"`,
`NoteNameInput`'s `aria-label="New note name"`) over CSS class chains, so
they track intentional accessibility contracts instead of styling.

## Not part of `npm test`

Unit tests (`npm test`, Vitest) stay fast and hermetic; this suite is a
separate `npm run test:e2e` script and is not wired into that command.

## CI wiring — follow-up, not done here

This suite is not yet wired into CI. A follow-up should add a job that runs
`npm run build`, `npx playwright install --with-deps chromium`, then
`npm run test:e2e`, uploading the HTML report and any `test-results/`
traces/screenshots/videos as artifacts on failure.
