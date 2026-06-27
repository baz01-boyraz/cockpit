import { useState } from 'react'
import type { ApprovalRequest } from '@shared/domain'
import { useStore } from '../store/useStore'
import { IconCheck, IconShield, IconX } from './icons'

const RISK_CLASS: Record<string, string> = {
  low: 'chip--success',
  medium: 'chip--warning',
  high: 'chip--warning',
  critical: 'chip--danger',
}

export function ApprovalCard({ request }: { request: ApprovalRequest }) {
  const decide = useStore((s) => s.decideApproval)
  const [busy, setBusy] = useState(false)
  const resolved = request.status !== 'pending'
  const strong = request.riskLevel === 'critical'

  const onDecide = async (approve: boolean) => {
    setBusy(true)
    try {
      await decide(request.id, approve)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={`approval ${strong ? 'approval--strong' : ''} ${resolved ? 'approval--resolved' : ''}`}>
      <div className="approval__head">
        <IconShield width={14} height={14} />
        <span className="approval__action mono">{request.actionType}</span>
        <span className={`chip ${RISK_CLASS[request.riskLevel] ?? 'chip--warning'}`}>
          {request.riskLevel}
        </span>
      </div>
      <div className="approval__summary">{request.summary}</div>

      {resolved ? (
        <div className={`approval__resolved ${request.status === 'approved' ? 'is-ok' : 'is-no'}`}>
          {request.status === 'approved' ? 'Approved' : 'Rejected'}
        </div>
      ) : (
        <div className="approval__actions">
          <button className="btn btn--sm btn--danger" disabled={busy} onClick={() => onDecide(false)}>
            <IconX width={13} height={13} /> Reject
          </button>
          <button className="btn btn--sm btn--accent" disabled={busy} onClick={() => onDecide(true)}>
            <IconCheck width={13} height={13} /> {strong ? 'Confirm & approve' : 'Approve'}
          </button>
        </div>
      )}
    </div>
  )
}
