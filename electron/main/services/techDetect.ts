import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Best-effort tech-stack detection from a project directory. Read-only and
 * defensive: any unreadable/missing file is simply skipped.
 */
export function detectTechStack(path: string): string[] {
  const found = new Set<string>()

  const pkgPath = join(path, 'package.json')
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as {
        dependencies?: Record<string, string>
        devDependencies?: Record<string, string>
      }
      const deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) }
      const map: Record<string, string> = {
        next: 'Next.js',
        react: 'React',
        vue: 'Vue',
        svelte: 'Svelte',
        '@angular/core': 'Angular',
        vite: 'Vite',
        tailwindcss: 'Tailwind',
        typescript: 'TypeScript',
        express: 'Express',
        fastify: 'Fastify',
        electron: 'Electron',
        prisma: 'Prisma',
        '@nestjs/core': 'NestJS',
      }
      for (const [dep, label] of Object.entries(map)) {
        if (deps[dep]) found.add(label)
      }
    } catch {
      /* ignore malformed package.json */
    }
  }

  const fileSignals: { file: string; label: string }[] = [
    { file: 'requirements.txt', label: 'Python' },
    { file: 'pyproject.toml', label: 'Python' },
    { file: 'manage.py', label: 'Django' },
    { file: 'main.py', label: 'Python' },
    { file: 'go.mod', label: 'Go' },
    { file: 'Cargo.toml', label: 'Rust' },
    { file: 'Gemfile', label: 'Ruby' },
    { file: 'composer.json', label: 'PHP' },
    { file: 'Dockerfile', label: 'Docker' },
    { file: 'docker-compose.yml', label: 'Docker' },
    { file: 'pom.xml', label: 'Java' },
    { file: 'pubspec.yaml', label: 'Flutter' },
    { file: 'Package.swift', label: 'Swift' },
  ]
  for (const sig of fileSignals) {
    if (existsSync(join(path, sig.file))) found.add(sig.label)
  }

  // crude FastAPI / Postgres hints
  const reqPath = join(path, 'requirements.txt')
  if (existsSync(reqPath)) {
    try {
      const req = readFileSync(reqPath, 'utf8').toLowerCase()
      if (req.includes('fastapi')) found.add('FastAPI')
      if (req.includes('psycopg') || req.includes('asyncpg')) found.add('PostgreSQL')
    } catch {
      /* ignore */
    }
  }

  return [...found]
}
