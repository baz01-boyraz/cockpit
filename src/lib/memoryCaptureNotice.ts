import type { MemoryCaptureNotice } from '@shared/memory-capture'

export interface MemoryCaptureNoticeView {
  tone: 'saved' | 'review'
  eyebrow: string
  title: string
  summary: string
  detail: string
  persistent: boolean
}

export function memoryCaptureNoticeKey(notice: MemoryCaptureNotice): string {
  return [notice.projectId, notice.provider, notice.scope, notice.slug, notice.outcome].join(':')
}

export function memoryCaptureNoticeView(notice: MemoryCaptureNotice): MemoryCaptureNoticeView {
  const provider = notice.provider === 'claude' ? 'Claude' : 'Codex'
  const review = notice.outcome === 'review'
  const action = notice.outcome === 'updated' ? 'updated' : 'saved'
  return {
    tone: review ? 'review' : 'saved',
    eyebrow: review
      ? `Memory needs a decision · ${provider} → Cockpit`
      : `Memory ${action} · ${provider} → Cockpit`,
    title: notice.title,
    summary: notice.summary,
    detail: `${notice.scope === 'global' ? 'Global' : 'Project'} · ${notice.reason}`,
    persistent: review,
  }
}
