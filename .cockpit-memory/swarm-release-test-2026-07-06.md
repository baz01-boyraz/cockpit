---
schema: 2
name: swarm-release-test-2026-07-06
title: Swarm release test — 2026-07-06
class: reference
gate: manual
updatedAt: 2026-07-13T05:20:43.982Z
status: archived
authority: legacy
scope: project
confidence: low
firstSeenAt: 2026-07-13T05:20:43.982Z
reviewAfter: 2026-07-13T05:20:43.982Z
---

## Swarm release test — 2026-07-06

Yeni release (v0.1.44) sonrası swarm testi başarıyla tamamlandı. Tüm adımlar çalıştı:
- Kart oluşturma, start etme, worker spawn (Claude Code)
- Worker bir dosya oluşturdu, git status kontrol etti, typecheck + lint çalıştırdı
- Typecheck ve lint clean geçti

**Karşılaşılan sorun:**
- Terminal limit hatası (max 6 per project): Eski done/parked kartların terminal session'ları `TerminalManager.live` map'te birikmişti. `onExit` handler'ı session'ı map'ten silmiyor, sadece status'u 'exited' yapıyor. `count()` tüm live entry'leri saydığı için limit doluyor. App restart (npm run app:refresh) ile çözüldü.
- Çözüm için TerminalManager.ts'te onExit handler'ına `this.live.delete(sessionId)` eklenmeli.