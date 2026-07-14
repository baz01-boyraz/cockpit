import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { MemoryNote } from '@shared/memory-hub'
import type { LedgerEntry } from '@shared/memory-ledger'
import { MemoryReader } from './MemoryReader'

const note: MemoryNote = {
  name: 'memory-source',
  title: 'Memory source',
  content: `---
schema: 1
name: memory-source
title: Memory source
class: decision
session: claude:claude-session-1
gate: save
updatedAt: 2026-07-13T10:00:00.000Z
---

# Memory source

Durable fact.`,
  updatedAt: '2026-07-13T10:05:00.000Z',
  backlinks: [],
  outgoing: [],
  unresolved: [],
}

const history: LedgerEntry[] = [
  {
    id: 'ledger-merge',
    brain: 'project:project-1',
    noteSlug: note.name,
    action: 'merge',
    gate: 'save',
    sourceId: 'codex:codex-session-2',
    hashBefore: 'a'.repeat(64),
    hashAfter: 'b'.repeat(64),
    createdAt: '2026-07-13T10:05:00.000Z',
  },
  {
    id: 'ledger-create',
    brain: 'project:project-1',
    noteSlug: note.name,
    action: 'create',
    gate: 'save',
    sourceId: 'claude:claude-session-1',
    hashBefore: null,
    hashAfter: 'a'.repeat(64),
    createdAt: '2026-07-13T10:00:00.000Z',
  },
]

describe('MemoryReader provenance', () => {
  it('shows which provider created the note and which provider changed it most recently', () => {
    const html = renderToStaticMarkup(
      createElement(MemoryReader, {
        note,
        activity: { history, recalls7d: 1, recalls30d: 2 },
        mode: 'read',
        draft: note.content,
        saving: false,
        savedFlash: false,
        pendingCreate: null,
        known: new Set([note.name]),
        onDraftChange: () => undefined,
        onEdit: () => undefined,
        onSave: () => undefined,
        onCancelEdit: () => undefined,
        onRename: () => undefined,
        onTrash: () => undefined,
        onOpenLink: () => undefined,
        onOfferCreate: () => undefined,
        onCreatePending: () => undefined,
        onDismissPending: () => undefined,
      }),
    )

    expect(html).toContain('Created from')
    expect(html).toContain('Claude')
    expect(html).toContain('claude-session-1')
    expect(html).toContain('Last changed by')
    expect(html).toContain('Codex')
    expect(html).toContain('codex-session-2')
  })
})
