import {
  type MouseEvent,
  type PropsWithChildren,
  useEffect,
  useRef,
  useState,
} from 'react'
import { copyText } from '../lib/clipboard'

interface CouncilTextSurfaceProps extends PropsWithChildren {
  className?: string
  fullReport: string
}

interface MenuState {
  x: number
  y: number
  selection: string
}

export function CouncilTextSurface({
  children,
  className = '',
  fullReport,
}: CouncilTextSurfaceProps) {
  const surfaceRef = useRef<HTMLDivElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const [menu, setMenu] = useState<MenuState | null>(null)

  useEffect(() => {
    if (!menu) return
    menuRef.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus()
    const close = () => setMenu(null)
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close()
    }
    window.addEventListener('pointerdown', close)
    window.addEventListener('blur', close)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('pointerdown', close)
      window.removeEventListener('blur', close)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [menu])

  const handleContextMenu = (event: MouseEvent<HTMLDivElement>) => {
    const target = event.target
    if (target instanceof Element && target.closest('button, a, input, textarea, summary')) return
    event.preventDefault()
    const selection = window.getSelection()?.toString().trim() ?? ''
    setMenu({
      x: Math.max(8, Math.min(event.clientX, window.innerWidth - 190)),
      y: Math.max(8, Math.min(event.clientY, window.innerHeight - 132)),
      selection,
    })
  }

  const selectAll = () => {
    if (!surfaceRef.current) return
    const range = document.createRange()
    range.selectNodeContents(surfaceRef.current)
    const selection = window.getSelection()
    selection?.removeAllRanges()
    selection?.addRange(range)
    setMenu(null)
  }

  const copySelection = async () => {
    if (menu?.selection) await copyText(menu.selection)
    setMenu(null)
  }

  const copyReport = async () => {
    await copyText(fullReport)
    setMenu(null)
  }

  return (
    <div
      ref={surfaceRef}
      className={`councilSelectable ${className}`.trim()}
      onContextMenu={handleContextMenu}
    >
      {children}
      {menu && (
        <div
          ref={menuRef}
          className="councilTextMenu"
          role="menu"
          aria-label="Council text actions"
          style={{ left: menu.x, top: menu.y }}
          onPointerDown={(event) => event.stopPropagation()}
        >
          <button
            type="button"
            role="menuitem"
            disabled={!menu.selection}
            onClick={() => void copySelection()}
          >
            Copy selection
          </button>
          <button type="button" role="menuitem" onClick={selectAll}>
            Select all report
          </button>
          <button type="button" role="menuitem" onClick={() => void copyReport()}>
            Copy full report
          </button>
        </div>
      )}
    </div>
  )
}
