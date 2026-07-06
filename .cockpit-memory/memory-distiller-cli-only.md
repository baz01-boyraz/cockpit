---
schema: 1
name: memory-distiller-cli-only
title: Memory distiller: Baz's Claude subscription via local CLI only — locked
class: decision
capturedAt: 2026-07-04T20:49:58.279Z
gate: save
updatedAt: 2026-07-04T20:49:58.279Z
---

The memory distiller must call the LLM ONLY through the local `claude` CLI (reusing the shelved Hermes/ChatService `claude --print` path), i.e. Baz's own Claude subscription. Hard rule, not a default: no Anthropic API, no API key, no other provider, no fallback — ever. If the CLI is unreachable, capture pauses and waits rather than reaching for an API. Second locked decision: the gate does NOT use a fixed confidence threshold — the model itself judges each fact's importance, auto-saves what it's sure of, and asks Baz 'should I note this?' when unsure or when there's a conflict.

Related: [[memory-hub]], [[hermes-engine-direction]]
