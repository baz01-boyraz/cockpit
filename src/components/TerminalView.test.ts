import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { TerminalRole, TerminalSession } from '@shared/domain'
import { TerminalView } from './TerminalView'

// The renderer effect owns real xterm construction; this server-render test only
// verifies discoverable markup, so keep the UMD addon out of Node's `self`-less
// environment.
vi.mock('@xterm/xterm', () => ({ Terminal: class Terminal {} }))
vi.mock('@xterm/addon-fit', () => ({ FitAddon: class FitAddon {} }))

function session(role: TerminalRole | null): TerminalSession {
  return {
    id: `term-${role ?? 'shell'}`,
    projectId: 'project-1',
    name: role === 'codex' ? 'Codex' : role === 'claude' ? 'Claude Code' : 'Shell',
    role,
    alias: null,
    cwd: '/tmp/project',
    shell: '/bin/zsh',
    status: 'running',
    pid: 42,
    exitCode: null,
    createdAt: '2026-07-09T00:00:00.000Z',
    lastActiveAt: '2026-07-09T00:00:00.000Z',
  }
}

describe('TerminalView affordances', () => {
  it('keeps agent panes free of prompt middleware — the memory contract rides the CLI, not the UI', () => {
    for (const role of ['codex', 'claude'] as const) {
      const html = renderToStaticMarkup(createElement(TerminalView, { session: session(role), active: true }))

      // The retired dock intercepted prompts to prepend memory context. User
      // input now reaches the TUI verbatim; nothing may sit between them.
      expect(html).not.toContain('prompt dock')
      expect(html).not.toContain('codexdock')
      expect(html).not.toContain('Draft a prompt')
    }
  })

  it('adds an exact-send editor composer to every terminal type', () => {
    for (const role of ['general', 'claude', 'codex'] as const) {
      const html = renderToStaticMarkup(createElement(TerminalView, { session: session(role), active: true }))

      expect(html).toContain('aria-label="Terminal composer"')
      expect(html).toContain('aria-label="Search terminal history"')
      expect(html).toContain('aria-label="Send terminal input"')
      expect(html).toContain('Shift+Enter')
      expect(html).toContain('Ctrl+R')
    }
  })

  it('keeps the composer as the one writing place with image staging inside it', () => {
    const html = renderToStaticMarkup(createElement(TerminalView, { session: session('claude'), active: true }))

    // Images stage as composer chips; the toolbar no longer auto-sends paths.
    expect(html).toContain('aria-label="Attach image"')
    expect(html).not.toContain('Send screenshot')
    // Typing at the terminal reroutes here — the placeholder says so.
    expect(html).toContain('typing anywhere lands here')
  })

  it('keeps the shared terminal affordances on every pane', () => {
    const html = renderToStaticMarkup(createElement(TerminalView, { session: session('general'), active: true }))

    expect(html).toContain('aria-label="Scroll terminal up one page"')
    expect(html).toContain('aria-label="Scroll terminal down one page"')
    expect(html).toContain('aria-label="Jump to live terminal output"')
  })
})
