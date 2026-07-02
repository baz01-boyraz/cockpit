# CLAUDE.md — cockpiT

> Read this first, every session. It is the operating contract for working in this repo.

## What this is

cockpiT is a **project-aware AI coding cockpit** — a desktop app (Electron)
for daily coding work. It is **not** a terminal wrapper. Terminals are only the execution
layer. The product is the cockpit: project awareness, an AI agent router, Git confidence,
infra (Railway) awareness, error intelligence, and usage visibility.

Principles it draws from (without cloning any): Linear (precision, dark native UI), Warp
(calm terminal-focused surfaces), Vercel/Railway (infra clarity), GitHub Desktop (visual Git
confidence).

## Architecture (do not violate)

- **Electron, secure by default.** `contextIsolation: true`, `nodeIntegration: false`,
  `sandbox: true`. The renderer talks to main **only** through the narrow typed preload bridge
  (`window.cockpit`). No arbitrary command execution from the renderer.
- **Main process owns** all capability: `electron/main/services/*` — TerminalManager (node-pty),
  ProjectService, GitService, RailwayService, LocalCommandRunner, ApprovalService,
  AuditLogService, UsageService, LogIntelligenceService, SecretStore, plus the SQLite layer.
- **Renderer owns UI only** (`src/`). It never imports Node APIs.
- **`shared/`** holds the domain types, Zod schemas, the IPC contract, and pure logic
  (router, log patterns, approval rules, redaction, usage) used by **both** sides. Keep it
  runtime-dependency-free so it works in the browser mock too.
- Every IPC handler validates its payload with a Zod schema. The renderer is untrusted input.

### Mock bridge
The renderer runs against `window.cockpit` in Electron, or a fully-featured **mock**
(`src/lib/mock.ts`) when served as a plain web page. This is what makes the localhost
screenshot workflow possible — and it must stay in sync with the real `CockpitApi`.

## Security rules (non-negotiable)

1. Local-first. The renderer never receives raw secrets.
2. Never send secrets to AI. Mask `.env` values, API keys, tokens, private keys
   (`shared/redaction.ts`). Reading `.env` is masked by default.
3. Store Railway/GitHub tokens via OS keychain (`SecretStore` / `safeStorage`) — never in
   SQLite or project config. Config holds a `tokenRef`, not the value.
4. These require approval: `git_force_push`, `deploy`, `redeploy`,
   `restart_service`, `delete_file`, `database_reset`, `env_write`. Force-push and DB reset
   require **strong** approval and always gate regardless of config. **The gate is enforced
   in the main process**: a gated action must present the id of an approved request, which
   `ApprovalService.consume()` verifies and spends (single-use) before execution — see the
   `guarded()` wrapper in `registerIpc.ts`; every future mutating handler must go through it.
   A regular `git_push` executes directly (non-destructive, audit-logged) from the Git
   panel — it is the one write path enabled for the developer's own loop.
5. Keep an audit log of AI/tool actions (redacted). Real pushes are recorded with `actor: user`.
6. **This build does not** actually force-push, deploy, mutate env vars, restart services, or
   wipe databases. Those paths are stubbed/approval-gated by design. A regular push **does**
   run `git push` against the active branch's `origin`.

## Frontend work — always do first

1. **Apply frontend-design thinking before writing UI.** If a project-local `frontend-design`
   skill exists, use it; otherwise apply the rules in `docs/DESIGN.md`.
2. Check `brand_assets/` before designing. If real logos/colors exist, use them. (None yet —
   we use the original system in `src/styles/tokens.css`.)
3. **Never** use default Tailwind blue/indigo. Our accent is ember/copper with a signal-lime
   secondary. No `transition-all`. Animate only `transform`/`opacity`. Every interactive
   element needs hover, focus-visible, and active states. Layered surfaces, not one flat plane.

## Screenshot / visual review workflow

Always serve on **localhost**, never `file://`.

```bash
npm run build          # builds main + preload + renderer into out/
node serve.mjs         # serves out/renderer at http://localhost:3000
node screenshot.mjs http://localhost:3000 dashboard
```

- Screenshots auto-save to `temporary screenshots/screenshot-N[-label].png` (never overwritten).
- Read the PNG back with the Read tool, compare against intent, fix, re-screenshot.
- Do **at least 2 review rounds**. Be specific about pixel-level fixes.

## Commands

| Command | What |
|---|---|
| `npm run dev` | Electron + Vite dev (HMR) |
| `npm run build` | Build main/preload/renderer to `out/` |
| `npm run typecheck` | tsc (node + web projects) |
| `npm run lint` | ESLint (flat config, 0 warnings) |
| `npm test` | Vitest (pure-logic unit tests) |
| `npm run rebuild` | Rebuild `better-sqlite3` for Electron's ABI |
| `npm run serve` / `npm run screenshot` | Localhost serve + Puppeteer shot |
| `npm run app:refresh` | Build unsigned macOS app, replace `/Applications/cockpiT.app`, relaunch |
| `npm run package:release` | Build local macOS `dmg` + `zip` artifacts without publishing |
| `npm run package:publish` | CI-only: build macOS `dmg` + `zip` and publish GitHub release artifacts |

## Local app refresh workflow

When the user asks to commit/push and refresh the app, use this sequence:

1. Run the relevant checks for the change.
2. Commit and push only the intended files.
3. Run `npm run app:refresh`.

`npm run app:refresh` is the development refresh path for the installed local app. It packages
the current code, quits the running `cockpiT` app if needed, replaces the installed `.app`
bundle, removes quarantine metadata if present, and opens the refreshed app. It is not a remote
auto-updater; GitHub push alone does not update a local desktop app.

## GitHub release update workflow

The production update path is GitHub Releases + `electron-updater`:

Hard rule: **CI is the only publisher for release artifacts. Never run a local publish against
GitHub for a tagged release.** A previous mixed local+CI publish left `latest-mac.yml` pointing
at one ZIP/DMG while GitHub assets were overwritten by another build; `electron-updater` then
failed download validation. Keep metadata and assets from the same CI run.

1. Commit all app changes to `main`. `npm test` must be green — the redaction and
   force-push-gate suites are release blockers (the IPC contract test joins them in Phase 2
   of `docs/cockpit-VISION.md`).
2. Bump `package.json` version and tag the release (`vX.Y.Z`).
3. Push `main` with tags.
4. GitHub Actions runs `.github/workflows/release.yml`.
5. CI deletes any partial release for that exact tag, then builds `dmg` + `zip`, signs/notarizes
   when secrets are present, and publishes release metadata plus matching assets.
6. Verify the workflow succeeds and `gh release view vX.Y.Z` shows `latest-mac.yml`, ZIP, DMG,
   and blockmaps from the same run.
7. Only then ask the app to check/download/install the update.

Use `npm run package:release` only to produce local artifacts for inspection. It uses
`--publish never`. The CI workflow uses `npm run package:publish`.

Required repository secrets for signed/notarized production releases:

- `MAC_CERTIFICATE_BASE64`
- `MAC_CERTIFICATE_PASSWORD`
- `APPLE_ID`
- `APPLE_APP_SPECIFIC_PASSWORD`
- `APPLE_TEAM_ID`

Without those secrets, local/dev builds still work, but production macOS auto-update is not
distribution-ready.

## Native modules

- `better-sqlite3` is NAN-based → must be rebuilt for Electron (`npm run rebuild`). Tests never
  import it (they run under Node), so the two ABIs don't conflict.
- `node-pty` ships N-API prebuilds (ABI-stable). `postinstall` (`scripts/fix-native.mjs`)
  restores the executable bit on `spawn-helper` that npm extraction drops — without it, pty
  spawns fail with `posix_spawnp failed`.

## Limits for now

No Monaco editor, no real Railway mutations, and no deploys. Production auto-update plumbing is
present, but signed/notarized release readiness depends on Apple certificate/notary secrets.
Local unsigned app refresh is handled by `npm run app:refresh`.
Keep files focused (< 800 lines), prefer many small modules, immutable updates, explicit error
handling.
