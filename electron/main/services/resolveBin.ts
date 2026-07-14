import { accessSync, constants, existsSync, realpathSync } from 'node:fs'
import { createRequire } from 'node:module'
import { homedir } from 'node:os'
import { basename, dirname, join } from 'node:path'

interface CodexNativeTarget {
  packageName: string
  triple: string
  executable: string
}

function codexNativeTarget(
  platform: NodeJS.Platform,
  arch: string,
): CodexNativeTarget | null {
  const suffix = platform === 'win32' ? '.exe' : ''
  if ((platform === 'linux' || platform === 'android') && arch === 'x64') {
    return {
      packageName: '@openai/codex-linux-x64',
      triple: 'x86_64-unknown-linux-musl',
      executable: `codex${suffix}`,
    }
  }
  if ((platform === 'linux' || platform === 'android') && arch === 'arm64') {
    return {
      packageName: '@openai/codex-linux-arm64',
      triple: 'aarch64-unknown-linux-musl',
      executable: `codex${suffix}`,
    }
  }
  if (platform === 'darwin' && arch === 'x64') {
    return {
      packageName: '@openai/codex-darwin-x64',
      triple: 'x86_64-apple-darwin',
      executable: `codex${suffix}`,
    }
  }
  if (platform === 'darwin' && arch === 'arm64') {
    return {
      packageName: '@openai/codex-darwin-arm64',
      triple: 'aarch64-apple-darwin',
      executable: `codex${suffix}`,
    }
  }
  if (platform === 'win32' && arch === 'x64') {
    return {
      packageName: '@openai/codex-win32-x64',
      triple: 'x86_64-pc-windows-msvc',
      executable: `codex${suffix}`,
    }
  }
  if (platform === 'win32' && arch === 'arm64') {
    return {
      packageName: '@openai/codex-win32-arm64',
      triple: 'aarch64-pc-windows-msvc',
      executable: `codex${suffix}`,
    }
  }
  return null
}

function isExecutable(path: string): boolean {
  try {
    accessSync(path, constants.X_OK)
    return true
  } catch {
    return false
  }
}

/**
 * Resolve the native binary behind @openai/codex's `#!/usr/bin/env node`
 * launcher. Finder-launched apps do not inherit a version-manager PATH, so the
 * JavaScript launcher otherwise exits before Codex starts even though its
 * platform package is installed beside (Bun) or beneath (npm) the wrapper.
 */
export function resolveCodexNative(
  entrypoint: string,
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch,
): string | null {
  const target = codexNativeTarget(platform, arch)
  if (!target) return null

  let realEntrypoint: string
  try {
    realEntrypoint = realpathSync(entrypoint)
  } catch {
    return null
  }
  const packageRoot = dirname(dirname(realEntrypoint))
  if (basename(realEntrypoint) !== 'codex.js' || basename(packageRoot) !== 'codex') {
    return null
  }

  const packageLeaf = target.packageName.slice('@openai/'.length)
  const vendorRoots: string[] = []
  try {
    const packageJson = createRequire(realEntrypoint).resolve(`${target.packageName}/package.json`)
    vendorRoots.push(join(dirname(packageJson), 'vendor'))
  } catch {
    // Known global-install layouts below cover packages without resolvable exports.
  }
  vendorRoots.push(
    join(packageRoot, 'node_modules', '@openai', packageLeaf, 'vendor'),
    join(dirname(packageRoot), packageLeaf, 'vendor'),
    join(packageRoot, 'vendor'),
  )

  for (const vendorRoot of new Set(vendorRoots)) {
    const native = join(vendorRoot, target.triple, 'bin', target.executable)
    if (isExecutable(native)) return native
  }
  return null
}

/**
 * Resolve a CLI binary to an absolute path. A macOS GUI app launched from
 * Finder/Dock does NOT inherit the shell PATH, so a bare `execFile('gh', …)`
 * fails with ENOENT even when the CLI is installed and authenticated. We probe
 * the common install locations explicitly and fall back to the bare name (which
 * still works when the app is launched from a terminal).
 */
const cache = new Map<string, string>()

export function resolveBin(name: string): string {
  const cached = cache.get(name)
  if (cached !== undefined) return cached
  const candidates = [
    join(homedir(), '.local/bin', name),
    `/opt/homebrew/bin/${name}`,
    `/usr/local/bin/${name}`,
    join(homedir(), '.bun/bin', name),
  ]
  const entrypoint = candidates.find((p) => existsSync(p))
  const resolved = entrypoint
    ? (name === 'codex' ? resolveCodexNative(entrypoint) : null) ?? entrypoint
    : name
  cache.set(name, resolved)
  return resolved
}
