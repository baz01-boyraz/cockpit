import { describe, expect, it } from 'vitest'
import {
  composeAgentText,
  parseAgentFile,
  RESERVED_AGENT_SLUGS,
  type NamedAgent,
} from '../shared/named-agents'

const FILE = `---
name: vulcan
description: Backend builder for services and APIs.
tools: Read, Write, Edit, Bash, Grep, Glob
model: sonnet
cockpit:
  displayName: Vulcan
  tagline: The forge never lies
  color: copper
  role: builder
  persona: type-zealot
---

You are **Vulcan** — the forge god.

## Craft rules
- Validate every boundary.
`

describe('parseAgentFile', () => {
  it('parses frontmatter, cockpit extension keys, and the body', () => {
    const a = parseAgentFile(FILE)
    expect(a).not.toBeNull()
    expect(a!.slug).toBe('vulcan')
    expect(a!.description).toContain('Backend builder')
    expect(a!.model).toBe('sonnet')
    expect(a!.displayName).toBe('Vulcan')
    expect(a!.tagline).toBe('The forge never lies')
    expect(a!.color).toBe('copper')
    expect(a!.role).toBe('builder')
    expect(a!.persona).toBe('type-zealot')
    expect(a!.body).toContain('forge god')
    expect(a!.body).toContain('Craft rules')
    expect(a!.body).not.toContain('---')
    expect(a!.cockpitTagged).toBe(true)
  })

  it('falls back gracefully when cockpit keys are missing', () => {
    const a = parseAgentFile(`---\nname: plain\ndescription: d\n---\nBody.`)
    expect(a!.displayName).toBe('plain')
    expect(a!.role).toBeNull()
    expect(a!.persona).toBeNull()
    expect(a!.color).toBeNull()
    // No cockpit: block → a plain Claude Code subagent, not a roster teammate.
    expect(a!.cockpitTagged).toBe(false)
  })

  it('rejects files without frontmatter or name, and reserved/invalid slugs', () => {
    expect(parseAgentFile('just text')).toBeNull()
    expect(parseAgentFile(`---\ndescription: no name\n---\nx`)).toBeNull()
    expect(parseAgentFile(`---\nname: General Purpose!\n---\nx`)).toBeNull()
    for (const reserved of RESERVED_AGENT_SLUGS) {
      expect(parseAgentFile(`---\nname: ${reserved}\n---\nx`)).toBeNull()
    }
  })

  it('treats a "cockpit-like" indented block under another key as opaque', () => {
    const a = parseAgentFile(`---\nname: x\nother:\n  displayName: NOT ME\n---\nb`)
    expect(a!.displayName).toBe('x')
    expect(a!.cockpitTagged).toBe(false)
  })
})

describe('composeAgentText', () => {
  const agent = parseAgentFile(FILE) as NamedAgent

  it('folds identity body plus role/persona defaults', () => {
    const t = composeAgentText(agent)
    expect(t.indexOf('forge god')).toBeGreaterThan(-1)
    expect(t).toContain('BUILDER')
    expect(t).toContain('type-safety zealot')
  })

  it('body comes first — identity leads, function follows', () => {
    const t = composeAgentText(agent)
    expect(t.indexOf('forge god')).toBeLessThan(t.indexOf('BUILDER'))
  })

  it('works with no role/persona at all', () => {
    const bare = parseAgentFile(`---\nname: solo\n---\nJust me.`) as NamedAgent
    expect(composeAgentText(bare)).toBe('Just me.')
  })
})
