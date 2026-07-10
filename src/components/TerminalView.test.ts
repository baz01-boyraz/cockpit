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
    name: role === 'codex' ? 'Codex' : 'Shell',
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
  it('gives Codex sessions a discoverable normal-text prompt dock', () => {
    const html = renderToStaticMarkup(createElement(TerminalView, { session: session('codex'), active: true }))

    expect(html).toContain('aria-label="Codex prompt dock"')
    expect(html).toContain('Draft a prompt')
    expect(html).toContain('normal edit · paste · undo · multi-line')
  })

  it('keeps the Codex-only dock out of ordinary shell panes', () => {
    const html = renderToStaticMarkup(createElement(TerminalView, { session: session('general'), active: true }))

    expect(html).not.toContain('aria-label="Codex prompt dock"')
    expect(html).toContain('aria-label="Scroll terminal up one page"')
    expect(html).toContain('aria-label="Scroll terminal down one page"')
    expect(html).toContain('aria-label="Jump to live terminal output"')
  })
})
