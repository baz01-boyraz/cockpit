import type { DragEvent } from 'react'

/**
 * Shared image-attachment helpers used by both the terminal drop zone and the
 * AI Cockpit chat. Keeping these in one place means the two surfaces accept the
 * exact same formats, size limit, and drag/paste detection.
 */
export type ImageMimeType = 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif'

export const IMAGE_ACCEPT = 'image/png,image/jpeg,image/webp,image/gif'
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024

const IMAGE_MIME_TYPES = new Set<ImageMimeType>(['image/png', 'image/jpeg', 'image/webp', 'image/gif'])
const IMAGE_MIME_BY_EXT: Record<string, ImageMimeType> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
}

export function inferImageMime(file: File): ImageMimeType | null {
  if (IMAGE_MIME_TYPES.has(file.type as ImageMimeType)) return file.type as ImageMimeType
  const ext = file.name.split('.').pop()?.toLowerCase()
  return ext ? IMAGE_MIME_BY_EXT[ext] ?? null : null
}

export function firstImage(files: FileList): File | null {
  for (let i = 0; i < files.length; i += 1) {
    const file = files.item(i)
    if (file && inferImageMime(file)) return file
  }
  return null
}

export function firstImageFromItems(items: DataTransferItemList): File | null {
  for (let i = 0; i < items.length; i += 1) {
    const item = items[i]
    if (item.kind !== 'file') continue
    const file = item.getAsFile()
    if (file && inferImageMime(file)) return file
  }
  return null
}

export function hasFileDrag(event: DragEvent<Element>): boolean {
  return Array.from(event.dataTransfer.types).includes('Files')
}

export function readBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = String(reader.result ?? '')
      resolve(result.includes(',') ? result.slice(result.indexOf(',') + 1) : result)
    }
    reader.onerror = () => reject(reader.error ?? new Error('Could not read image.'))
    reader.readAsDataURL(file)
  })
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
