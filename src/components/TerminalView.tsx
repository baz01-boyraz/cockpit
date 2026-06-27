import { useEffect, useRef } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import type { TerminalSession } from '@shared/domain'
import { cockpit } from '../lib/cockpit'

const THEME = {
  background: '#0e0f13',
  foreground: '#ece6da',
  cursor: '#e07b45',
  cursorAccent: '#0e0f13',
  selectionBackground: 'rgba(224,123,69,0.28)',
  black: '#14161c',
  red: '#e2563d',
  green: '#93c46a',
  yellow: '#e3a93f',
  blue: '#6fa8c4',
  magenta: '#c08bd0',
  cyan: '#5fb3b3',
  white: '#ece6da',
  brightBlack: '#645f57',
  brightRed: '#f0786a',
  brightGreen: '#c4e35a',
  brightYellow: '#f0c06a',
  brightBlue: '#8fc4dc',
  brightMagenta: '#d6a8e0',
  brightCyan: '#8fd6d6',
  brightWhite: '#ffffff',
}

export function TerminalView({ session, active }: { session: TerminalSession; active: boolean }) {
  const hostRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)
  const fitRef = useRef<FitAddon | null>(null)

  useEffect(() => {
    const host = hostRef.current
    if (!host) return

    const term = new Terminal({
      fontFamily: "'SF Mono', 'JetBrains Mono', ui-monospace, Menlo, monospace",
      fontSize: 12.5,
      lineHeight: 1.35,
      letterSpacing: 0.2,
      cursorBlink: true,
      theme: THEME,
      allowProposedApi: true,
      scrollback: 5000,
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(host)
    try {
      fit.fit()
    } catch {
      /* host not measured yet */
    }
    termRef.current = term
    fitRef.current = fit

    const api = cockpit()
    const offData = api.terminals.onData((chunk) => {
      if (chunk.sessionId === session.id) term.write(chunk.data)
    })
    const sub = term.onData((data) => void api.terminals.write(session.id, data))

    const onResize = () => {
      try {
        fit.fit()
        api.terminals.resize(session.id, term.cols, term.rows)
      } catch {
        /* ignore */
      }
    }
    const ro = new ResizeObserver(onResize)
    ro.observe(host)

    return () => {
      offData()
      sub.dispose()
      ro.disconnect()
      term.dispose()
      termRef.current = null
    }
  }, [session.id])

  useEffect(() => {
    if (active && fitRef.current) {
      requestAnimationFrame(() => {
        try {
          fitRef.current?.fit()
        } catch {
          /* ignore */
        }
      })
    }
  }, [active])

  return <div className="termview" ref={hostRef} />
}
