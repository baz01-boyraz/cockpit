import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import type { Project, ProjectConfig } from '@shared/domain'
import { projectConfigSchema } from '@shared/schemas'
import type { Db } from '../db/Database'
import { newId, nowIso, safeJson } from '../util/ids'
import { detectTechStack } from './techDetect'

interface ProjectRow {
  id: string
  name: string
  path: string
  tech_stack_json: string
  created_at: string
  updated_at: string
  last_opened_at: string | null
}

const CONFIG_DIR = '.dev-cockpit'
const CONFIG_FILE = 'project.json'

/**
 * Owns project registration and the on-disk project config. A project is the
 * top-level unit of the cockpit: a directory on disk plus a `.dev-cockpit/
 * project.json` describing its terminals, Railway wiring, and safety policy.
 */
export class ProjectService {
  constructor(private readonly db: Db) {}

  list(): Project[] {
    const rows = this.db
      .prepare('SELECT * FROM projects ORDER BY COALESCE(last_opened_at, updated_at) DESC')
      .all() as ProjectRow[]
    return rows.map(this.toProject)
  }

  get(projectId: string): Project {
    const row = this.db.prepare('SELECT * FROM projects WHERE id = ?').get(projectId) as
      | ProjectRow
      | undefined
    if (!row) throw new Error(`Project ${projectId} not found`)
    return this.toProject(row)
  }

  add(input: { path: string; name?: string }): Project {
    const path = input.path
    if (!existsSync(path)) throw new Error(`Path does not exist: ${path}`)

    const existing = this.db.prepare('SELECT * FROM projects WHERE path = ?').get(path) as
      | ProjectRow
      | undefined
    if (existing) return this.toProject(existing)

    const techStack = detectTechStack(path)
    const name = input.name?.trim() || basename(path)
    const now = nowIso()
    const project: Project = {
      id: newId('prj'),
      name,
      path,
      techStack,
      createdAt: now,
      updatedAt: now,
      lastOpenedAt: now,
    }

    this.db
      .prepare(
        `INSERT INTO projects (id, name, path, tech_stack_json, created_at, updated_at, last_opened_at)
         VALUES (@id, @name, @path, @techStack, @createdAt, @updatedAt, @lastOpenedAt)`,
      )
      .run({
        id: project.id,
        name: project.name,
        path: project.path,
        techStack: JSON.stringify(project.techStack),
        createdAt: project.createdAt,
        updatedAt: project.updatedAt,
        lastOpenedAt: project.lastOpenedAt,
      })

    this.ensureConfigFile(project)
    return project
  }

  select(projectId: string): Project {
    const project = this.get(projectId)
    this.db
      .prepare('UPDATE projects SET last_opened_at = ? WHERE id = ?')
      .run(nowIso(), projectId)
    // make sure the config file & row exist for an older project
    this.ensureConfigFile(project)
    return { ...project, lastOpenedAt: nowIso() }
  }

  getConfig(projectId: string): ProjectConfig {
    const row = this.db
      .prepare('SELECT config_json FROM project_configs WHERE project_id = ?')
      .get(projectId) as { config_json: string } | undefined
    if (row) {
      const parsed = projectConfigSchema.safeParse(safeJson(row.config_json, {}))
      if (parsed.success) return parsed.data
    }
    // fall back to building a fresh default from the project record
    const project = this.get(projectId)
    return this.ensureConfigFile(project)
  }

  private defaultConfig(project: Project): ProjectConfig {
    return projectConfigSchema.parse({
      version: 1,
      project: { name: project.name, path: project.path, techStack: project.techStack },
      terminals: {
        max: 6,
        layout: [],
        profiles: [
          { name: 'Dev server', cwd: '.', command: null, role: 'frontend' },
          { name: 'Claude Code', cwd: '.', command: 'claude', role: 'claude' },
          { name: 'Codex', cwd: '.', command: 'codex', role: 'codex' },
        ],
      },
      railway: { projectId: null, environmentId: null, services: [] },
      safety: {
        requireApprovalFor: [
          'git_push',
          'git_force_push',
          'deploy',
          'redeploy',
          'restart_service',
          'delete_file',
          'database_reset',
          'env_write',
        ],
      },
    })
  }

  /** Read the on-disk config if present, otherwise write a default. Persist to db. */
  private ensureConfigFile(project: Project): ProjectConfig {
    const dir = join(project.path, CONFIG_DIR)
    const file = join(dir, CONFIG_FILE)
    let config: ProjectConfig

    if (existsSync(file)) {
      const parsed = projectConfigSchema.safeParse(safeJson(readFileSync(file, 'utf8'), {}))
      config = parsed.success ? parsed.data : this.defaultConfig(project)
    } else {
      config = this.defaultConfig(project)
      try {
        if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
        writeFileSync(file, JSON.stringify(config, null, 2))
      } catch {
        // read-only project dir is fine; we still persist to the db below
      }
    }

    this.db
      .prepare(
        `INSERT INTO project_configs (project_id, config_path, config_json, updated_at)
         VALUES (@projectId, @configPath, @configJson, @updatedAt)
         ON CONFLICT(project_id) DO UPDATE SET config_json = @configJson, config_path = @configPath, updated_at = @updatedAt`,
      )
      .run({
        projectId: project.id,
        configPath: file,
        configJson: JSON.stringify(config),
        updatedAt: nowIso(),
      })
    return config
  }

  private toProject(row: ProjectRow): Project {
    return {
      id: row.id,
      name: row.name,
      path: row.path,
      techStack: safeJson<string[]>(row.tech_stack_json, []),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      lastOpenedAt: row.last_opened_at,
    }
  }
}
