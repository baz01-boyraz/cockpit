import { useEffect, useState } from 'react'
import { useStore } from '../store/useStore'
import { cockpit } from '../lib/cockpit'
import { IconBolt, IconDownload, IconRestart, IconX } from './icons'
import { AnimatedDownload } from './AnimatedDownload'

// Remember the version a developer waved away so the card stops nagging for that
// release — a newer version clears it because the stored string no longer matches.
// localStorage (not SQLite/IPC) keeps this purely a renderer concern, the same
// way the notepad drawer does.
const DISMISS_KEY = 'cockpit.update.dismissed.v1'

function readDismissed(): string | null {
  try {
    return localStorage.getItem(DISMISS_KEY)
  } catch {
    return null
  }
}

function shortNote(releaseName: string | null, releaseNotes: string | null): string | null {
  if (releaseName) return releaseName
  if (!releaseNotes) return null
  const firstLine = releaseNotes.split('\n').find((line) => line.trim().length > 0)
  return firstLine?.trim() ?? null
}

export function UpdateToast() {
  const appUpdate = useStore((s) => s.appUpdate)
  const [dismissed, setDismissed] = useState<string | null>(readDismissed)
  const [busy, setBusy] = useState(false)

  // A fresh release supersedes any earlier dismissal, so drop the stale flag the
  // moment the latest version differs from what was last hidden.
  useEffect(() => {
    if (appUpdate?.latestVersion && dismissed && appUpdate.latestVersion !== dismissed) {
      setDismissed(null)
    }
  }, [appUpdate?.latestVersion, dismissed])

  const phase = appUpdate?.phase
  const isFlowing = phase === 'downloading' || phase === 'downloaded'
  const isActionable = phase === 'available' || isFlowing
  // Once a download is in flight we keep showing it regardless of an earlier
  // dismissal — the developer is mid-install and needs the restart control.
  const hiddenByDismiss = phase === 'available' && appUpdate?.latestVersion === dismissed

  if (!appUpdate || !isActionable || hiddenByDismiss) return null

  const dismiss = () => {
    if (appUpdate.latestVersion) {
      try {
        localStorage.setItem(DISMISS_KEY, appUpdate.latestVersion)
      } catch {
        /* private mode / quota — fall back to in-memory hide */
      }
      setDismissed(appUpdate.latestVersion)
    }
  }

  const runAction = async () => {
    setBusy(true)
    try {
      if (phase === 'available') await cockpit().appUpdate.download()
      else if (phase === 'downloaded') await cockpit().appUpdate.install()
      // Progress + phase transitions arrive over appUpdate.onChange, so the card
      // re-renders itself without an explicit refresh here.
    } catch {
      /* error state is surfaced via the store subscription */
    } finally {
      setBusy(false)
    }
  }

  const note = shortNote(appUpdate.releaseName, appUpdate.releaseNotes)
  const percent = Math.round(appUpdate.progressPercent ?? 0)
  const title =
    phase === 'downloaded'
      ? 'Update ready to install'
      : phase === 'downloading'
        ? 'Downloading update'
        : 'New update available'

  return (
    <div className="updateToast" role="status" aria-live="polite">
      <span className="updateToast__glow" aria-hidden="true" />
      <div className="updateToast__head">
        <span className="updateToast__badge" aria-hidden="true">
          <IconBolt width={15} height={15} />
        </span>
        <span className="updateToast__title">{title}</span>
        <button
          type="button"
          className="updateToast__close"
          onClick={dismiss}
          aria-label="Dismiss update notification"
        >
          <IconX width={13} height={13} />
        </button>
      </div>

      <div className="updateToast__version mono">
        <span className="updateToast__from">v{appUpdate.currentVersion}</span>
        <span className="updateToast__arrow" aria-hidden="true">
          →
        </span>
        <span className="updateToast__to">v{appUpdate.latestVersion ?? 'latest'}</span>
      </div>

      {note && <p className="updateToast__note">{note}</p>}

      {isFlowing && (
        <AnimatedDownload
          percent={phase === 'downloaded' ? 100 : percent}
          phase={phase === 'downloaded' ? 'downloaded' : 'downloading'}
          version={appUpdate.latestVersion}
        />
      )}

      {phase !== 'downloading' && (
        <button
          type="button"
          className="updateToast__action"
          onClick={runAction}
          disabled={busy}
        >
          {phase === 'downloaded' ? (
            <IconRestart width={14} height={14} />
          ) : (
            <IconDownload width={14} height={14} />
          )}
          {phase === 'downloaded'
            ? busy
              ? 'Restarting…'
              : 'Restart & install'
            : busy
              ? 'Starting…'
              : 'Download update'}
        </button>
      )}
    </div>
  )
}
