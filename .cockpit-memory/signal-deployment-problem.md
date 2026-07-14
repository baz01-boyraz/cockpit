---
schema: 2
name: signal-deployment-problem
title: Stale Railway assumption in deploy_failed log rule
class: gotcha
gate: save
updatedAt: 2026-07-14T06:06:06.207Z
status: active
authority: observed
scope: project
confidence: medium
firstSeenAt: 2026-07-14T06:06:06.207Z
reviewAfter: 2026-10-12T06:06:06.207Z
---

# Deployment problem

Symptom (verbatim):
Deployment problem
A deploy or service on the infrastructure provider failed or crashed. · Check the service logs in the Railway panel before redeploying (redeploy needs approval).

Recurred 3× as a `log-intelligence` sentinel signal — a repeat-offender pattern worth remembering.

captured from recurring sentinel signal sig_1cf7eda8990b470b
- (2026-07-14) In shared/log-patterns.ts, the deploy_failed log rule catches a generic deployment failure message and always suggests Railway as a solution, without checking the actual provider. The project does not use Railway for deployment, so this notification is misleading. The rule should either remove the Railway suggestion or make it provider-aware.
