# CLAUDE.md — Baz Developer Cockpit

> Read this first, every session. It is the operating contract for working in this repo.

## What this is

Baz Developer Cockpit is a **project-aware AI coding cockpit** — a desktop app (Electron)
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
4. These require approval: `git_push`, `git_force_push`, `deploy`, `redeploy`,
   `restart_service`, `delete_file`, `database_reset`, `env_write`. Force-push and DB reset
   require **strong** approval and always gate regardless of config.
5. Keep an audit log of AI/tool actions (redacted).
6. **This build does not** actually push, force-push, deploy, mutate env vars, restart
   services, or wipe databases. Those paths are stubbed/approval-gated by design.

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

## Native modules

- `better-sqlite3` is NAN-based → must be rebuilt for Electron (`npm run rebuild`). Tests never
  import it (they run under Node), so the two ABIs don't conflict.
- `node-pty` ships N-API prebuilds (ABI-stable). `postinstall` (`scripts/fix-native.mjs`)
  restores the executable bit on `spawn-helper` that npm extraction drops — without it, pty
  spawns fail with `posix_spawnp failed`.

## Limits for now

No Monaco editor, no real Railway mutations, no deploys, no packaging/distribution work yet.
Keep files focused (< 800 lines), prefer many small modules, immutable updates, explicit error
handling.
