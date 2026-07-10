import { useEffect, useRef, useState, type ComponentType, type KeyboardEvent, type SVGProps } from 'react'
import { useStore, type View } from '../store/useStore'
import { IconChevron, IconFocus, IconSettings, IconShieldSearch, IconUsage } from './icons'

type ControlView = Extract<View, 'audit' | 'usage' | 'settings'>

interface ControlItem {
  view: ControlView
  label: string
  description: string
  Icon: ComponentType<SVGProps<SVGSVGElement>>
}

const CONTROL_ITEMS: ControlItem[] = [
  {
    view: 'audit',
    label: 'Audit & approvals',
    description: 'Activity trail and past decisions',
    Icon: IconShieldSearch,
  },
  {
    view: 'usage',
    label: 'Engine usage',
    description: 'Quotas, windows, and capacity',
    Icon: IconUsage,
  },
  {
    view: 'settings',
    label: 'Settings',
    description: 'Connections and preferences',
    Icon: IconSettings,
  },
]

const CONTROL_VIEWS = new Set<View>(CONTROL_ITEMS.map((item) => item.view))

/**
 * Low-frequency workspace utilities live behind one deliberate rail affordance
 * instead of competing with daily build destinations. The menu keeps every
 * destination labelled and described, and supports Escape plus arrow-key
 * navigation so the compact hierarchy does not cost discoverability.
 */
export function ControlCenterMenu() {
  const view = useStore((s) => s.view)
  const setView = useStore((s) => s.setView)
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([])
  const active = CONTROL_VIEWS.has(view)

  useEffect(() => {
    if (!open) return

    const onPointerDown = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false)
    }
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape') return
      setOpen(false)
      triggerRef.current?.focus()
    }

    window.addEventListener('mousedown', onPointerDown)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('mousedown', onPointerDown)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  const focusItem = (index: number) => {
    const items = itemRefs.current.filter((item): item is HTMLButtonElement => item !== null)
    if (items.length === 0) return
    items[(index + items.length) % items.length]?.focus()
  }

  const openAndFocus = () => {
    setOpen(true)
    window.requestAnimationFrame(() => focusItem(0))
  }

  const onTriggerKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== 'ArrowDown') return
    event.preventDefault()
    openAndFocus()
  }

  const onMenuKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const items = itemRefs.current.filter((item): item is HTMLButtonElement => item !== null)
    const current = items.indexOf(document.activeElement as HTMLButtonElement)
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      focusItem(current + 1)
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      focusItem(current - 1)
    } else if (event.key === 'Home') {
      event.preventDefault()
      focusItem(0)
    } else if (event.key === 'End') {
      event.preventDefault()
      focusItem(items.length - 1)
    }
  }

  const choose = (next: ControlView) => {
    setView(next)
    setOpen(false)
    window.requestAnimationFrame(() => triggerRef.current?.focus())
  }

  return (
    <div className="railControl" ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        className={`railControl__trigger ${active ? 'railControl__trigger--active' : ''}`}
        onClick={() => setOpen((value) => !value)}
        onKeyDown={onTriggerKeyDown}
        aria-label={open ? 'Close control center' : 'Open control center'}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls="rail-control-menu"
        aria-current={active ? 'page' : undefined}
        title="Audit, usage, and settings"
      >
        <span className="railControl__triggerGlyph" aria-hidden="true">
          <IconFocus width={17} height={17} />
        </span>
        <span className="railControl__triggerLabel railControl__triggerLabel--full">
          Control center
        </span>
        <span className="railControl__triggerLabel railControl__triggerLabel--compact">Controls</span>
        <IconChevron
          className={`railControl__triggerChevron ${open ? 'railControl__triggerChevron--open' : ''}`}
          width={14}
          height={14}
          aria-hidden="true"
        />
      </button>

      {open && (
        <div
          id="rail-control-menu"
          className="railControl__menu"
          role="menu"
          aria-label="Control center"
          onKeyDown={onMenuKeyDown}
        >
          <div className="railControl__head">
            <span className="railControl__eyebrow">Workspace controls</span>
            <span className="railControl__title">Control center</span>
          </div>
          <div className="railControl__items">
            {CONTROL_ITEMS.map(({ view: target, label, description, Icon }, index) => (
              <button
                key={target}
                ref={(node) => {
                  itemRefs.current[index] = node
                }}
                type="button"
                role="menuitem"
                className={`railControl__item ${view === target ? 'railControl__item--active' : ''}`}
                aria-current={view === target ? 'page' : undefined}
                onClick={() => choose(target)}
              >
                <span className="railControl__itemGlyph" aria-hidden="true">
                  <Icon width={17} height={17} />
                </span>
                <span className="railControl__itemCopy">
                  <span className="railControl__itemLabel">{label}</span>
                  <span className="railControl__itemDescription">{description}</span>
                </span>
                <IconChevron className="railControl__itemChevron" width={13} height={13} aria-hidden="true" />
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
