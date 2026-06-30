/**
 * macOS afterSign hook for electron-builder.
 *
 * Two jobs, in order:
 *   1. Notarize — only when full Apple credentials are present (skipped for the
 *      free self-signed path and for local unsigned builds).
 *   2. Verify signing identity — when the workflow declares an expected identity
 *      (COCKPIT_EXPECT_IDENTITY), assert the packaged .app actually carries it.
 *      electron-builder SILENTLY falls back to an ad-hoc signature when it cannot
 *      resolve the configured identity; that ships a "damaged"-looking unsigned
 *      app and breaks Squirrel.Mac auto-update. afterSign runs before DMG/ZIP
 *      creation and publish, so throwing here aborts the release cleanly instead
 *      of shipping a broken build.
 */
const { notarize } = require('@electron/notarize')
const { join } = require('node:path')
const { execSync } = require('node:child_process')

exports.default = async function afterSign(context) {
  if (context.electronPlatformName !== 'darwin') return

  const appName = context.packager.appInfo.productFilename
  const appPath = join(context.appOutDir, `${appName}.app`)

  const appleId = process.env.APPLE_ID
  const appleIdPassword = process.env.APPLE_APP_SPECIFIC_PASSWORD
  const teamId = process.env.APPLE_TEAM_ID

  if (appleId && appleIdPassword && teamId) {
    console.log(`[notarize] Submitting ${appPath}`)
    await notarize({
      appBundleId: context.packager.appInfo.appId,
      appPath,
      appleId,
      appleIdPassword,
      teamId,
    })
    console.log('[notarize] Complete')
  } else {
    console.log('[notarize] Apple credentials not present; skipping notarization')
  }

  const expectIdentity = process.env.COCKPIT_EXPECT_IDENTITY
  if (!expectIdentity) return

  let out = ''
  try {
    out = execSync(`codesign -dvvv "${appPath}" 2>&1`, { encoding: 'utf8' })
  } catch (err) {
    out = `${err.stdout || ''}${err.stderr || ''}`
  }

  const signedByExpected = out.includes(`Authority=${expectIdentity}`)
  const adhoc = /Signature=adhoc/.test(out)
  if (!signedByExpected || adhoc) {
    throw new Error(
      `[verify-signature] Expected "${appName}.app" signed by "${expectIdentity}", ` +
        `but codesign reports:\n${out}`,
    )
  }
  console.log(`[verify-signature] OK — "${appName}.app" signed by "${expectIdentity}"`)
}
