/**
 * Post-install fixups for native modules.
 *
 * node-pty ships prebuilt `spawn-helper` binaries, but npm's tarball extraction
 * does not always preserve the executable bit. Without +x, node-pty fails at
 * runtime with "posix_spawnp failed". We restore it here for the current
 * platform so a clean `npm install` yields a working terminal layer.
 */
import { chmodSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(fileURLToPath(import.meta.url), '..', '..')

const candidates = [
  'node_modules/node-pty/prebuilds/darwin-arm64/spawn-helper',
  'node_modules/node-pty/prebuilds/darwin-x64/spawn-helper',
  'node_modules/node-pty/build/Release/spawn-helper',
]

let fixed = 0
for (const rel of candidates) {
  const abs = resolve(root, rel)
  if (existsSync(abs)) {
    try {
      chmodSync(abs, 0o755)
      fixed += 1
    } catch (err) {
      console.warn(`[fix-native] could not chmod ${rel}:`, err.message)
    }
  }
}

console.log(`[fix-native] ensured executable bit on ${fixed} spawn-helper binary(ies)`)
