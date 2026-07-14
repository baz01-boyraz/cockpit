---
schema: 2
name: memory-health-lifecycle-sensor
title: Memory olayları Sentinel kaynağına dönüştürüldü
class: architecture
capturedAt: 2026-07-14T05:04:16.538Z
gate: save
updatedAt: 2026-07-14T05:10:29.035Z
status: active
authority: observed
scope: project
confidence: medium
firstSeenAt: 2026-07-14T05:04:16.538Z
reviewAfter: 2026-10-12T05:04:16.538Z
---

Capture, distiller, review queue, curation ve compliance olayları eşikli, dedup'lı Sentinel sensörlerine bağlandı. Ham içerik sızmaz, yalnız sayı/yaş/kategori geçer. Normal hata ses çıkarmaz, eşik aşımı bildirir.

Related: [[sentinel-3-layer-architecture]], [[memory-gate-metrics-audit-log]], [[memory-hub]], [[memory-archived-notes-leak]]
- (2026-07-14) Arşivlenmiş ve superseded notlar halen ana `notes` koleksiyonuna giriyor; sağlık sayacı ve graph da geçmişi aktif bilgi sanıyor. Düzeltme: ana liste yalnız aktif notları göstermeli, arşiv ayrı ve erişilebilir olmalı, graph yalnız aktif düğümleri çizmeli.
