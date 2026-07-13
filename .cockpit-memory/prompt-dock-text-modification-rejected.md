---
schema: 2
name: prompt-dock-text-modification-rejected
title: Prompt dock's text-modification approach was rejected — invisible channel as fix
class: gotcha
capturedAt: 2026-07-11T03:28:40.209Z
gate: save
updatedAt: 2026-07-11T03:28:40.209Z
status: active
authority: legacy
scope: project
confidence: low
firstSeenAt: 2026-07-11T03:28:40.209Z
reviewAfter: 2026-10-11T05:20:43.983Z
---

The prompt dock added a memory-lookup instruction block to the user's prompt via prepareAgentPrompt chain — the user's text never reached the agent byte-for-byte. Baz rejected this fundamentally: 'ben yazdigimin ustune birseyler eklesin ekstra yazilar yazsin istemiyorum' (I don't want extra text added on top of what I wrote). Fix: memory contract moved to engine-native invisible channels (Claude hooks, Codex AGENTS.md system prompt) that never touch user content. Symptom that should trigger the fix: a user who consistently sees unexpected text preceding their prompt in the agent's input.

Related: [[memory-contract-invisible-channel]], [[terminal-memory-contract]]
