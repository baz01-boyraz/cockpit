---
schema: 1
name: boot-zombie-audit
title: Boot zombie-PID liveness audit with recency guard + conservative SIGTERM
class: architecture
capturedAt: 2026-07-09T08:40:42.864Z
gate: save
updatedAt: 2026-07-09T08:40:42.864Z
---

A4 added boot-time zombie-PID reconciliation. reconcileStaleRows() captures pre-flip state (id/pid/last_active_at before UPDATE flips status to 'exited'). Services.reconcileZombies() runs right after TerminalManager's row reconcile. Rules: only terminal_sessions rows that are ours (no foreign PIDs ever touched); 7-day recency guard (rows older than 7 days skipped — pid-reuse protection) before process.kill; single SIGTERM (not SIGTERM group — muhafazakar, pid-reuse riskine karşı); every decision audits system.zombie_reaped (per row) + system.zombie_sweep (summary count). Entire block is try/catch-wrapped — never blocks or throws during boot (same contract as worktree-prune).

Related: [[multiagent-isolated-worktree]]
