---
schema: 1
name: council-multi-engine-architecture
title: Multi-engine council: Claude CLI + Codex CLI + OpenRouter HTTP
class: decision
capturedAt: 2026-07-08T01:58:54.755Z
gate: save
updatedAt: 2026-07-08T02:47:04.598Z
---

Council architecture upgraded from single-model (5× Claude local CLI) to multi-vendor: three engines via adapter pattern in shared/engines.ts (pure, zero-dependency) + EngineRunner with DI. Council now has two operating modes: (1) spec mode (pre-build — refine task prompt before Swarm worker starts), and (2) judge mode (post-build — evaluate diff against acceptance criteria). Builder seat added (Codex/GPT engine) that must produce feasibility notes, effort estimate, and ambiguity list; chairman's approved spec + builder's notes + critical objections flow into the worker's opening prompt. Hermes integrates via council_refine_spec MCP tool (same decoupled MCP surface, no direct Hermes↔council link). OpenRouter key stays in main process (ref-based SecretStore, never crosses IPC). Chairman always on Claude opus (abonement, not OpenRouter credit). ENGINE_MODEL_RE allows empty string for Codex ('use default', {0,64} regex).

Related: [[swarm-design]], [[hermes-mcp-architecture]], [[openrouter-secret-ref-gotcha]], [[coding-fallback-order]]
- (2026-07-08) Council v2 finalised in multi-phase build. Seat roster: 3 vendors (Claude, Codex, DeepSeek) × 3 Claude tiers (Opus, Sonnet, Haiku), 'builder' seat replaces old 'executor', chairman fallback on empty ranking. Compact payload contract: `council_refine_spec` MCP tool returns only `{verdictKind, questions, refinedSpec, ranking, sessionId}` — seat texts NEVER flow back to Hermes (token savings + leak hygiene). Spec-gate protocol embedded in tool description itself: interview first (2-4 batched questions each with a default assumption so 'ok' is complete), draft spec with Goal/Context/Acceptance/Out of scope/Constraints sections, gate → NEEDS_CLARIFICATION (relay questions verbatim, re-run) → APPROVED (use refinedSpec + sessionId). Protocol lives in tool descriptions so Hermes follows it even without AGENTS.md. FK-less `council_sessions` table: session is record-history, survives card deletion (V11 principle, V12 extends same pattern with `council_session_id` on `kanban_cards`). Council brief applied at every pipeline step (not just first), silently degrades to no-brief on missing/throws. DB migration: IF NOT EXISTS append-only, follows V1–V10 pattern; no runnable replay test because better-sqlite3 unavailable in Node test context.
