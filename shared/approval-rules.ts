/**
 * Approval risk classification (pure, testable).
 *
 * Maps an action type to a baseline risk level and decides whether the action
 * needs to pass through the approval gate. Force-push, database reset, and
 * deploy are the highest-stakes actions and always require explicit approval.
 */
import type { ApprovalActionType, RiskLevel } from './domain'

const RISK: Record<ApprovalActionType, RiskLevel> = {
  git_push: 'high',
  git_force_push: 'critical',
  deploy: 'high',
  redeploy: 'high',
  restart_service: 'medium',
  delete_file: 'medium',
  database_reset: 'critical',
  env_write: 'high',
  shell_command: 'medium',
}

/** Actions that must never auto-execute, even if not in the project allowlist. */
const ALWAYS_REQUIRE: ApprovalActionType[] = [
  'git_force_push',
  'database_reset',
  'deploy',
  'redeploy',
]

export function riskLevelFor(action: ApprovalActionType): RiskLevel {
  return RISK[action] ?? 'medium'
}

/**
 * Decide whether an action needs approval given the project's configured
 * allowlist. An action requires approval if it is explicitly listed OR if it is
 * inherently dangerous (defense in depth — a misconfigured allowlist can never
 * silently enable a force-push or DB reset).
 */
export function requiresApproval(
  action: ApprovalActionType,
  configuredList: ApprovalActionType[],
): boolean {
  return ALWAYS_REQUIRE.includes(action) || configuredList.includes(action)
}

/** Stronger approval = critical actions get an extra confirmation in the UI. */
export function needsStrongApproval(action: ApprovalActionType): boolean {
  return riskLevelFor(action) === 'critical'
}
