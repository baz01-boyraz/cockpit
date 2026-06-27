import type { RouteRecommendation } from '@shared/domain'
import { IconBolt, IconShield } from './icons'

const AGENT_LABEL: Record<string, string> = {
  claude: 'Claude Code',
  codex: 'Codex CLI',
  local: 'Local command',
  chat: 'Chat mode',
  railway: 'Railway',
}

const RISK_CHIP: Record<string, string> = {
  safe: 'chip--success',
  caution: 'chip--warning',
  dangerous: 'chip--danger',
}

export function RouteCard({
  rec,
  primary,
  onAct,
}: {
  rec: RouteRecommendation
  primary?: boolean
  onAct: (rec: RouteRecommendation) => void
}) {
  const actionLabel = rec.requiresApproval
    ? 'Request approval'
    : rec.agent === 'claude' || rec.agent === 'codex'
      ? 'Launch in terminal'
      : rec.agent === 'local'
        ? 'Run (read-only)'
        : 'Open'

  return (
    <div className={`route ${primary ? 'route--primary' : ''}`}>
      <div className="route__head">
        <span className={`route__agent route__agent--${rec.agent}`}>{AGENT_LABEL[rec.agent]}</span>
        <span className="route__conf mono">{Math.round(rec.confidence * 100)}%</span>
        <span className={`chip ${RISK_CHIP[rec.risk]}`}>
          {rec.requiresApproval && <IconShield width={11} height={11} />}
          {rec.risk}
        </span>
      </div>
      <p className="route__rationale">{rec.rationale}</p>
      {rec.suggestedCommand && <code className="route__cmd mono">{rec.suggestedCommand}</code>}
      <button
        className={`btn btn--sm ${rec.requiresApproval ? '' : 'btn--accent'} route__act`}
        onClick={() => onAct(rec)}
      >
        <IconBolt width={13} height={13} />
        {actionLabel}
      </button>
    </div>
  )
}
