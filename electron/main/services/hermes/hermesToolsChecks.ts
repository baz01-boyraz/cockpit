import { runChecksSchema, takeAppScreenshotSchema } from '@shared/schemas'
import type { HermesTool, HermesToolContext } from './hermesToolTypes'

/**
 * Verification tools for Hermes' post-dispatch review (Faz 4 step 7).
 *
 * SECURITY: `run_checks` is NOT a free-form "run any npm script" surface. Its
 * `check` field is a closed enum (`runChecksSchema`) that the `run` handler
 * parses BEFORE the checks service is ever touched — so an invalid value is
 * rejected before any process can spawn. The service maps that enum to ONE of
 * three fixed commands (`npm test` / `npm run typecheck` / `npm run lint`); no
 * flags or arbitrary commands can flow through. This is the whole reason the
 * tool exists as an allowlist rather than a generic runner.
 */
export function createChecksTools(ctx: HermesToolContext): HermesTool[] {
  return [
    {
      name: 'run_checks',
      description:
        "Run one of the project's three fixed verification commands and get its exit code + captured output. `check` must be exactly 'test', 'typecheck', or 'lint' — mapped to `npm test`, `npm run typecheck`, `npm run lint` respectively. No other command, flags, or arguments are possible. Output is capped and the run is killed after 5 minutes (reported as timedOut) so a hanging suite never blocks.",
      inputShape: runChecksSchema.shape,
      run: async (raw) => {
        // Parse first: an invalid enum throws here, before any process spawns.
        const { projectId, check } = runChecksSchema.parse(raw)
        return ctx.checks.run(projectId, check)
      },
    },
    {
      name: 'take_app_screenshot',
      description:
        'Build the app fresh, serve it on localhost, and capture a PNG screenshot of the rendered UI. ALWAYS rebuilds first so it never shows stale output after a code change; if the build fails it returns an error instead of screenshotting the old build. `label` is a slug used in the filename; `url` (optional) must be a loopback address; `waitMs` (optional) delays the shot for animations. Returns the saved PNG file path (not the image bytes).',
      inputShape: takeAppScreenshotSchema.shape,
      run: async (raw) => {
        const { projectId, label, url, waitMs } = takeAppScreenshotSchema.parse(raw)
        return ctx.screenshot.capture(projectId, { label, url, waitMs })
      },
    },
  ]
}
