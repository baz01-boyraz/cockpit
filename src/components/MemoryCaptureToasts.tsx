import { useCallback, useEffect, useRef, useState } from 'react'
import type { MemoryCaptureNotice } from '@shared/memory-capture'
import { cockpit } from '../lib/cockpit'
import { memoryCaptureNoticeKey, memoryCaptureNoticeView } from '../lib/memoryCaptureNotice'
import { useStore } from '../store/useStore'
import { IconCheck, IconMemory, IconX } from './icons'

const SAVED_TTL_MS = 9_000
const MAX_VISIBLE = 3

/**
 * Out-of-band terminal feedback. It never writes bytes into the PTY, so a
 * notice cannot corrupt a TUI or re-enter the transcript it just described.
 */
export function MemoryCaptureToasts() {
  const activeProjectId = useStore((state) => state.activeProjectId)
  const setView = useStore((state) => state.setView)
  const [notices, setNotices] = useState<MemoryCaptureNotice[]>([])
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>())

  const dismiss = useCallback((key: string) => {
    const timer = timers.current.get(key)
    if (timer) clearTimeout(timer)
    timers.current.delete(key)
    setNotices((current) => current.filter((notice) => memoryCaptureNoticeKey(notice) !== key))
  }, [])

  useEffect(() => {
    setNotices([])
    for (const timer of timers.current.values()) clearTimeout(timer)
    timers.current.clear()
  }, [activeProjectId])

  useEffect(() => {
    const off = cockpit().memory.onCaptureNotice((notice) => {
      if (notice.projectId !== activeProjectId) return
      const key = memoryCaptureNoticeKey(notice)
      const existingTimer = timers.current.get(key)
      if (existingTimer) clearTimeout(existingTimer)
      setNotices((current) => [
        notice,
        ...current.filter((item) => memoryCaptureNoticeKey(item) !== key),
      ].slice(0, MAX_VISIBLE))
      if (notice.outcome !== 'review') {
        timers.current.set(key, setTimeout(() => dismiss(key), SAVED_TTL_MS))
      }
    })
    return off
  }, [activeProjectId, dismiss])

  useEffect(() => {
    const currentTimers = timers.current
    return () => {
      for (const timer of currentTimers.values()) clearTimeout(timer)
      currentTimers.clear()
    }
  }, [])

  if (notices.length === 0) return null

  return (
    <div className="memoryCaptureToasts" aria-label="Live Memory capture notifications">
      {notices.map((notice) => {
        const key = memoryCaptureNoticeKey(notice)
        const view = memoryCaptureNoticeView(notice)
        return (
          <article
            key={key}
            className={`memoryCaptureToast memoryCaptureToast--${view.tone}`}
            role={view.persistent ? 'alert' : 'status'}
          >
            <span className="memoryCaptureToast__icon" aria-hidden="true">
              {view.tone === 'saved' ? <IconCheck width={14} height={14} /> : <IconMemory width={14} height={14} />}
            </span>
            <div className="memoryCaptureToast__body">
              <div className="memoryCaptureToast__eyebrow">{view.eyebrow}</div>
              <strong>{view.title}</strong>
              <p>{view.summary}</p>
              <small>{view.detail}</small>
              {view.persistent && (
                <button type="button" onClick={() => setView('memory')}>
                  Open Memory
                </button>
              )}
            </div>
            <button
              type="button"
              className="memoryCaptureToast__close"
              aria-label="Dismiss Memory notification"
              onClick={() => dismiss(key)}
            >
              <IconX width={12} height={12} />
            </button>
          </article>
        )
      })}
    </div>
  )
}
