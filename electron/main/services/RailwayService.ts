import type {
  MaskedEnvVar,
  RailwayConnection,
  RailwayService as RailwaySvc,
  RailwayServiceStatus,
  RailwayServiceType,
} from '@shared/domain'
import { maskEnvEntry } from '@shared/redaction'
import type { Db } from '../db/Database'
import { nowIso } from '../util/ids'
import type { ProjectService } from './ProjectService'
import { railwayAvailable, railwayJson } from './railwayCli'

// --- shape of `railway status --json` (the bits we use) ---------------------
interface RailwayStatusJson {
  id?: string
  name?: string
  environments?: {
    edges: {
      node: {
        id: string
        name: string
        serviceInstances?: {
          edges: {
            node: {
              serviceId: string
              serviceName: string
              startCommand: string | null
              latestDeployment?: { status?: string } | null
              activeDeployments?: unknown[]
              domains?: { serviceDomains?: { domain?: string }[] }
            }
          }[]
        }
      }
    }[]
  }
}

function mapStatus(deployStatus?: string): RailwayServiceStatus {
  switch ((deployStatus ?? '').toUpperCase()) {
    case 'SUCCESS':
      return 'active'
    case 'BUILDING':
    case 'DEPLOYING':
    case 'INITIALIZING':
    case 'QUEUED':
      return 'building'
    case 'CRASHED':
    case 'FAILED':
      return 'crashed'
    case 'REMOVED':
    case 'REMOVING':
    case 'SLEEPING':
      return 'stopped'
    default:
      return 'unknown'
  }
}

function inferType(name: string): RailwayServiceType {
  const n = name.toLowerCase()
  if (/(postgres|mysql|redis|mongo|database|db)/.test(n)) return 'database'
  if (/(web|frontend|front|next|client|ui)/.test(n)) return 'frontend'
  if (/(worker|cron|job|queue)/.test(n)) return 'worker'
  return 'backend'
}

/**
 * Railway integration backed by the real, user-authenticated `railway` CLI.
 *
 * Connection state is derived from whether the active project's directory is
 * linked to a Railway project (`railway status` succeeds). No token is ever
 * handled by the app — auth lives in the CLI session created by `railway login`.
 * Mutations (restart/redeploy/env write) are NOT performed here; they are routed
 * through the approval gate by the UI.
 */
export class RailwayService {
  constructor(
    private readonly _db: Db,
    private readonly projects: ProjectService,
  ) {
    void this._db
  }

  private cwd(projectId: string): string {
    return this.projects.get(projectId).path
  }

  private firstEnv(status: RailwayStatusJson | null) {
    return status?.environments?.edges.find((e) => e.node.name === 'production')?.node ??
      status?.environments?.edges[0]?.node ??
      null
  }

  async status(projectId: string): Promise<RailwayConnection> {
    const cwd = this.cwd(projectId)
    const available = await railwayAvailable(cwd)
    const status = available ? await railwayJson<RailwayStatusJson>(['status', '--json'], cwd) : null
    const env = this.firstEnv(status)
    const connected = Boolean(status?.name)

    return {
      id: status?.id ?? (connected ? 'linked' : 'unconnected'),
      projectId,
      railwayProjectId: status?.id ?? null,
      railwayEnvironmentId: env?.id ?? null,
      tokenRef: null,
      connected,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    }
  }

  async services(projectId: string): Promise<RailwaySvc[]> {
    const cwd = this.cwd(projectId)
    if (!(await railwayAvailable(cwd))) return []
    const status = await railwayJson<RailwayStatusJson>(['status', '--json'], cwd)
    const env = this.firstEnv(status)
    if (!env?.serviceInstances) return []

    const now = nowIso()
    return env.serviceInstances.edges.map(({ node }) => {
      const domain = node.domains?.serviceDomains?.[0]?.domain ?? null
      return {
        id: node.serviceId,
        connectionId: status?.id ?? 'linked',
        railwayServiceId: node.serviceId,
        name: node.serviceName,
        serviceType: inferType(node.serviceName),
        status: mapStatus(node.latestDeployment?.status),
        url: domain ? `https://${domain}` : null,
        startCommand: node.startCommand,
        updatedAt: now,
      }
    })
  }

  async env(projectId: string): Promise<MaskedEnvVar[]> {
    const cwd = this.cwd(projectId)
    if (!(await railwayAvailable(cwd))) return []
    const status = await railwayJson<RailwayStatusJson>(['status', '--json'], cwd)
    const env = this.firstEnv(status)
    const serviceName = env?.serviceInstances?.edges[0]?.node.serviceName
    if (!serviceName) return []

    // `railway variables --json` returns raw values — mask before returning.
    const vars = await railwayJson<Record<string, string>>(
      ['variables', '--service', serviceName, '--json'],
      cwd,
    )
    if (!vars || typeof vars !== 'object') return []

    return Object.entries(vars).map(([key, value]) => {
      const v = typeof value === 'string' ? value : String(value)
      const { maskedValue, masked } = maskEnvEntry(key, v)
      return { key, maskedValue, masked }
    })
  }
}
