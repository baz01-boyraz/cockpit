---
schema: 1
name: dashboard-hero-declutter
title: Dashboard hero must not show usage stats
class: decision
capturedAt: 2026-07-05T05:58:35.292Z
gate: save
updatedAt: 2026-07-05T05:58:35.292Z
---

The dashboard hero's 'ENGINES · Claude % / Codex %' box (HeroEngines component) was deliberately removed because usage is already shown in two other places: the left-rail footer strip and the Usage nav tab. Hero grid collapsed from 3 columns to 2 (identity | CTAs). Don't re-add usage/engine stats to the hero — it becomes a triplicate.

Related: [[molten-obsidian-design]]
