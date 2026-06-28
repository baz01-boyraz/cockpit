import { mkdirSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import type { TerminalAttachment } from '@shared/domain'
import { newId, nowIso } from '../util/ids'
import type { ProjectService } from './ProjectService'

type ImageMimeType = 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif'

interface TerminalImageInput {
  projectId: string
  sessionId?: string | null
  fileName: string
  mimeType: ImageMimeType
  dataBase64: string
}

const MAX_IMAGE_BYTES = 10 * 1024 * 1024
const EXT_BY_MIME: Record<ImageMimeType, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
  'image/gif': '.gif',
}

export class AttachmentService {
  constructor(private readonly projects: ProjectService) {}

  saveTerminalImage(input: TerminalImageInput): TerminalAttachment {
    const project = this.projects.get(input.projectId)
    const bytes = Buffer.from(input.dataBase64, 'base64')
    if (bytes.length === 0) throw new Error('Image attachment is empty.')
    if (bytes.length > MAX_IMAGE_BYTES) throw new Error('Image attachment must be 10 MB or smaller.')

    const id = newId('att')
    const ext = EXT_BY_MIME[input.mimeType]
    const stem = this.safeStem(input.fileName)
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    const name = `${stamp}-${id}-${stem}${ext}`
    const relativePath = `.dev-cockpit/attachments/${name}`
    const dir = join(project.path, '.dev-cockpit', 'attachments')
    const path = join(dir, name)

    mkdirSync(dir, { recursive: true })
    writeFileSync(path, bytes, { flag: 'wx' })

    return {
      id,
      projectId: input.projectId,
      sessionId: input.sessionId ?? null,
      name,
      path,
      relativePath,
      mimeType: input.mimeType,
      size: bytes.length,
      createdAt: nowIso(),
    }
  }

  private safeStem(fileName: string): string {
    const withoutExt = basename(fileName).replace(/\.[^.]*$/, '')
    const safe = withoutExt.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '')
    return safe.slice(0, 72) || 'screenshot'
  }
}
