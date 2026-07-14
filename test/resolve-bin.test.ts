import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { resolveCodexNative } from '../electron/main/services/resolveBin'

const roots: string[] = []

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'cockpit-resolve-bin-'))
  roots.push(root)
  return root
}

function executable(path: string): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, '')
  chmodSync(path, 0o755)
}

function codexLauncher(root: string): { launcher: string; packageRoot: string } {
  const packageRoot = join(root, 'node_modules', '@openai', 'codex')
  const script = join(packageRoot, 'bin', 'codex.js')
  const launcher = join(root, 'bin', 'codex')
  mkdirSync(dirname(script), { recursive: true })
  mkdirSync(dirname(launcher), { recursive: true })
  writeFileSync(script, '#!/usr/bin/env node\n')
  symlinkSync(script, launcher)
  return { launcher, packageRoot }
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('resolveCodexNative', () => {
  it('resolves the Bun-style sibling native package instead of the Node launcher', () => {
    const root = tempRoot()
    const { launcher } = codexLauncher(root)
    const native = join(
      root,
      'node_modules',
      '@openai',
      'codex-darwin-arm64',
      'vendor',
      'aarch64-apple-darwin',
      'bin',
      'codex',
    )
    executable(native)

    expect(resolveCodexNative(launcher, 'darwin', 'arm64')).toBe(native)
  })

  it('resolves an npm-style native package nested beneath the Codex package', () => {
    const root = tempRoot()
    const { launcher, packageRoot } = codexLauncher(root)
    const native = join(
      packageRoot,
      'node_modules',
      '@openai',
      'codex-darwin-arm64',
      'vendor',
      'aarch64-apple-darwin',
      'bin',
      'codex',
    )
    executable(native)

    expect(resolveCodexNative(launcher, 'darwin', 'arm64')).toBe(native)
  })

  it('returns null when the matching native package is unavailable', () => {
    const root = tempRoot()
    const { launcher } = codexLauncher(root)

    expect(resolveCodexNative(launcher, 'darwin', 'arm64')).toBeNull()
  })
})
