---
schema: 2
name: semantic-retrieval-default
title: Hibrit arama eklendi, İngilizce-Türkçe eşanlam kavramları yakalar
class: gotcha
capturedAt: 2026-07-14T05:04:16.520Z
gate: save
updatedAt: 2026-07-14T05:04:16.520Z
status: active
authority: observed
scope: project
confidence: medium
firstSeenAt: 2026-07-14T05:04:16.520Z
reviewAfter: 2026-10-12T05:04:16.520Z
---

Eskiden yalnızca lexical kelime eşleşmesi vardı. Artık yerleşik bilingual concept reranking ile 'Swarm bitince yönetici özeti' veya 'telefondan Telegram' gibi ifadeler doğru notu buluyor. Model/embedding maliyeti yok. Zayıf eşleşmeler filtrelenir.

Related: [[memory-recall]], [[memory-reconcile-dedup-gotcha]], [[memory-contract-invisible-channel]]
