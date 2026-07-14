import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { resolveBin, resolveCodexNative } from '../electron/main/services/resolveBin'

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
  it.each([
    ['linux', 'x64', 'codex-linux-x64', 'x86_64-unknown-linux-musl', 'codex'],
    ['linux', 'arm64', 'codex-linux-arm64', 'aarch64-unknown-linux-musl', 'codex'],
    ['android', 'arm64', 'codex-linux-arm64', 'aarch64-unknown-linux-musl', 'codex'],
    ['darwin', 'x64', 'codex-darwin-x64', 'x86_64-apple-darwin', 'codex'],
    ['darwin', 'arm64', 'codex-darwin-arm64', 'aarch64-apple-darwin', 'codex'],
    ['win32', 'x64', 'codex-win32-x64', 'x86_64-pc-windows-msvc', 'codex.exe'],
    ['win32', 'arm64', 'codex-win32-arm64', 'aarch64-pc-windows-msvc', 'codex.exe'],
  ] as const)(
    'resolves the Bun-style %s/%s native package instead of the Node launcher',
    (platform, arch, packageName, triple, executableName) => {
      const root = tempRoot()
      const { launcher } = codexLauncher(root)
      const native = join(
        root,
        'node_modules',
        '@openai',
        packageName,
        'vendor',
        triple,
        'bin',
        executableName,
      )
      executable(native)

      expect(resolveCodexNative(launcher, platform, arch)).toBe(realpathSync(native))
    },
  )

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

    expect(resolveCodexNative(launcher, 'darwin', 'arm64')).toBe(realpathSync(native))
  })

  it('returns null when the matching native package is unavailable', () => {
    const root = tempRoot()
    const { launcher } = codexLauncher(root)

    expect(resolveCodexNative(launcher, 'darwin', 'arm64')).toBeNull()
  })

  it('returns null for unsupported targets, missing entrypoints, and non-Codex launchers', () => {
    const root = tempRoot()
    const { launcher } = codexLauncher(root)
    const other = join(root, 'bin', 'claude')
    executable(other)

    expect(resolveCodexNative(launcher, 'freebsd', 'x64')).toBeNull()
    expect(resolveCodexNative(launcher, 'darwin', 'ppc64')).toBeNull()
    expect(resolveCodexNative(join(root, 'missing-codex'))).toBeNull()
    expect(resolveCodexNative(other, 'darwin', 'arm64')).toBeNull()
  })

  it('keeps the bare command fallback stable when no common install exists', () => {
    const missing = 'cockpit-definitely-missing-cli-for-resolver-test'

    expect(resolveBin(missing)).toBe(missing)
    expect(resolveBin(missing)).toBe(missing)
  })
})
