---
schema: 1
name: swarm-in-review-terminal-leak
title: Terminal sızıntısı gerçek kaynağı: In-review kartları terminali açık bırakıyor
class: gotcha
capturedAt: 2026-07-08T03:54:23.468Z
gate: save
updatedAt: 2026-07-08T03:54:23.468Z
---

Hermes'in sandığı gibi onExit'in live map'ten delete yapmaması terminal tüketmez — countActiveAgents yalnızca role==='claude'||'codex' && status==='running' sayar, exited'ları görmez. Gerçek kaynak: SwarmService'de done kartı → In review'a taşırken terminali 'açık kalmalı takip için' diye deliberately açık bırakıyor (reaper yok). Park() terminali öldürüyor, pipeline advance eski worker'ı öldürüyor, ama In-review'e geçiş terminali öldürmüyor. Bu, geçmişteki 18x launchd respawn olayından ayrı bir sorun.

Related: [[swarm-design]], [[terminal-exit-memory-trigger]]
