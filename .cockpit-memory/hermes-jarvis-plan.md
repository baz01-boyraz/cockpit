---
schema: 1
name: hermes-jarvis-plan
title: Hermes: three doors, one engine
class: architecture
capturedAt: 2026-07-05T21:31:21.396Z
gate: save
updatedAt: 2026-07-08T01:24:19.374Z
---

Hermes is one background engine (hermes-agent + DeepSeek V4 Pro) reached via 3 separate doors, all hitting the same engine: (1) cockpiT's revived Chat tab (Faz 6) for in-app supervised use, (2) Swarm board auto-fallback (Faz 4) when Claude quota hits 100% — invisible to the user except a 'working with Hermes' badge on the card, (3) Telegram remote dispatch (Faz 8) from phone while away from the Mac. Concrete flow for door 3: Telegram message → Hermes daemon (sender-restricted to Baz's Telegram account only) → edits files in the target project → commits but never pushes → replies in Telegram with a summary → Baz reviews/pushes later from cockpiT. Door 3 is explicitly gated: it will not be enabled until Phase 1 closes the sandbox/approval-gate bypass (open question 0).

Related: [[bridgespace-roadmap]]
- (2026-07-05) Confirmed with Baz: DeepSeek V4 Pro (via OpenRouter) is good value as a Claude-quota fallback — highest open-weight SWE-bench Verified score found (~80.6%), 1M context, ~$0.08 for a ~150K/20K token feature-build task. Caveat flagged to Baz: benchmarks mostly measure isolated bug-fix tasks; Claude is still likely more reliable on long, multi-constraint instructions ('do X, also watch for Y, but don't do Z'). Untested end-to-end in cockpiT's actual worker harness — that validation is Phase 1's job. Not meant to replace Claude as primary model; fallback-only, which is why the tradeoff is acceptable.
- (2026-07-08) Verdiği kararlar: (1) Bildirim kanalı — dashboard kartı yerine sağ-alt toast bildirimi, her görünümde (dashboard + terminal) çalışır, tıklayınca bağlamla birlikte Hermes chat açılır, onay bildirimlerinde toast içinde Approve/Reject. Rozetli kalıcı bildirim merkezi (geçmiş bildirimler). (2) Hermes şu an deepseek/deepseek-v4-flash üzerinde OpenRouter ile çalışıyor — orchestrator model notu. (3) Hermes training'de zorunlu kural: 'iddianı koddan doğrula, dosya:satır göster, emin değilsen hipotez olarak belirt'. (4) propose_swarm_card'a zorunlu evidence[], rootCause, confidence alanları. (5) Parallel work split kararı: Swarm terminal sızıntısı fix'i ayrı agent'a, Hermes backend + memory overhaul ayrı agent'a. Dashboard'daki bekleyen Hermes kartı Reject edilecek — yanlış teşhisle yazıldı.
