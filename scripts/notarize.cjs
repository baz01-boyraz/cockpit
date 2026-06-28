/**
 * Optional macOS notarization hook for electron-builder.
 *
 * Local unsigned builds intentionally skip this. CI release builds notarize only
 * when Apple credentials are present.
 */
const { notarize } = require('@electron/notarize')
const { join } = require('node:path')

exports.default = async function notarizeMac(context) {
  if (context.electronPlatformName !== 'darwin') return

  const appleId = process.env.APPLE_ID
  const appleIdPassword = process.env.APPLE_APP_SPECIFIC_PASSWORD
  const teamId = process.env.APPLE_TEAM_ID

  if (!appleId || !appleIdPassword || !teamId) {
    console.log('[notarize] Apple credentials not present; skipping notarization')
    return
  }

  const appName = context.packager.appInfo.productFilename
  const appPath = join(context.appOutDir, `${appName}.app`)
  console.log(`[notarize] Submitting ${appPath}`)
  await notarize({
    appBundleId: context.packager.appInfo.appId,
    appPath,
    appleId,
    appleIdPassword,
    teamId,
  })
  console.log('[notarize] Complete')
}
