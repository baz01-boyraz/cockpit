import { useEffect, useRef, useState } from 'react'
import { copyText } from '../lib/clipboard'
import { IconCheck, IconCopy, IconWarning } from './icons'

interface CopyTextButtonProps {
  text: string
  label: string
  copiedLabel?: string
  className?: string
  compact?: boolean
}

type CopyState = 'idle' | 'copied' | 'failed'

export function CopyTextButton({
  text,
  label,
  copiedLabel = `${label} copied`,
  className = '',
  compact = false,
}: CopyTextButtonProps) {
  const [state, setState] = useState<CopyState>('idle')
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    setState('idle')
  }, [text])

  useEffect(() => () => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current)
  }, [])

  const handleCopy = async () => {
    const copied = await copyText(text)
    setState(copied ? 'copied' : 'failed')
    if (timeoutRef.current) clearTimeout(timeoutRef.current)
    timeoutRef.current = setTimeout(() => setState('idle'), 1_600)
  }

  const visibleLabel = state === 'copied' ? copiedLabel : state === 'failed' ? 'Copy failed' : label
  const ariaLabel = state === 'copied' ? copiedLabel : state === 'failed' ? `${label} failed` : label
  const StateIcon = state === 'copied' ? IconCheck : state === 'failed' ? IconWarning : IconCopy

  return (
    <button
      type="button"
      className={`copyTextButton${compact ? ' copyTextButton--compact' : ''} ${className}`.trim()}
      onClick={() => void handleCopy()}
      disabled={!text}
      aria-label={ariaLabel}
      data-copy-state={state}
    >
      <StateIcon width={compact ? 12 : 14} height={compact ? 12 : 14} />
      <span>{visibleLabel}</span>
    </button>
  )
}
