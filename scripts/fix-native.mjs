/**
 * Post-install fixups for native modules.
 *
 * Electron 43 downloads its runtime lazily on first import. Parallel Vitest
 * workers can race that extraction on a clean checkout, so postinstall primes
 * it once, serially. node-pty also ships prebuilt `spawn-helper` binaries whose
 * executable bit npm does not always preserve; restore those after the runtime
 * is ready so a clean `npm install` yields a working desktop/terminal layer.
 */
import { spawnSync } from 'node:child_process'
import { chmodSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(fileURLToPath(import.meta.url), '..', '..')
const electronInstaller = resolve(root, 'node_modules/electron/install.js')

if (existsSync(electronInstaller)) {
  const installed = spawnSync(process.execPath, [electronInstaller], { stdio: 'inherit' })
  if (installed.error || installed.status !== 0) {
    throw installed.error ?? new Error(`Electron binary install exited with status ${installed.status}`)
  }
}

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
