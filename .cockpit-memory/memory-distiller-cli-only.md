---
schema: 1
name: memory-distiller-cli-only
title: Memory distiller: Baz's Claude subscription via local CLI only — locked
class: decision
capturedAt: 2026-07-04T20:49:58.279Z
gate: save
updatedAt: 2026-07-06T02:31:37.272Z
---

The memory distiller must call the LLM ONLY through the local `claude` CLI (reusing the shelved Hermes/ChatService `claude --print` path), i.e. Baz's own Claude subscription. Hard rule, not a default: no Anthropic API, no API key, no other provider, no fallback — ever. If the CLI is unreachable, capture pauses and waits rather than reaching for an API. Second locked decision: the gate does NOT use a fixed confidence threshold — the model itself judges each fact's importance, auto-saves what it's sure of, and asks Baz 'should I note this?' when unsure or when there's a conflict.

Related: [[memory-hub]], [[hermes-engine-direction]]
- (2026-07-06) Updated: distillation no longer uses local `claude` CLI (which consumed Claude coding quota). Now uses `hermes -z --ignore-rules` pointing at DeepSeek V4 Flash via OpenRouter (~$0.005-0.01 per call, negligible cost). Redaction (`shared/redaction.ts`) is applied before the call to prevent secret/env leakage. The distillation prompt was also augmented to explicitly ask for error/fix patterns ('gotchas'). Terminal exit (`terminal:exit` event) triggers immediate capture; idle-poll (90s, 10min idle) remains as fallback.
