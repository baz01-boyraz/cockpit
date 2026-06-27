/**
 * electron-builder afterPack hook.
 *
 * node-pty's `spawn-helper` must be executable inside the packaged app, but the
 * asar-unpack copy can lose its +x bit (same root cause as scripts/fix-native).
 * Without it the bundled app fails at runtime with "posix_spawnp failed". We
 * walk the packaged output and chmod every spawn-helper we find.
 */
const { chmodSync, existsSync, readdirSync, statSync } = require('node:fs')
const { join } = require('node:path')

function walk(dir, hits) {
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      walk(full, hits)
    } else if (entry.name === 'spawn-helper') {
      hits.push(full)
    }
  }
}

exports.default = async function afterPack(context) {
  const appOut = context.appOutDir
  if (!existsSync(appOut)) return
  const hits = []
  walk(appOut, hits)
  for (const file of hits) {
    try {
      if (statSync(file).isFile()) {
        chmodSync(file, 0o755)
        console.log(`[after-pack] chmod +x ${file}`)
      }
    } catch (err) {
      console.warn(`[after-pack] could not chmod ${file}: ${err.message}`)
    }
  }
  console.log(`[after-pack] fixed ${hits.length} spawn-helper binary(ies)`)
}
