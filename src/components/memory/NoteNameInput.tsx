import { useState } from 'react'
import { normalizeNoteName } from '@shared/wikilink'
import { IconPlus } from '../icons'

interface NoteNameInputProps {
  placeholder?: string
  ctaLabel?: string
  /** Molten CTA — reserve for the view's single primary moment (empty state). */
  accent?: boolean
  autoFocus?: boolean
  /** Resolves true when the note was created; the input then clears itself. */
  onSubmit: (slug: string) => Promise<boolean>
  onCancel?: () => void
}

/**
 * Note-name capture with a live slug hint: names become filename slugs by
 * construction (`vision roadmap` → `vision-roadmap.md`), so the hint shows the
 * exact file the hub will write before the user commits.
 */
export function NoteNameInput({
  placeholder = 'note name…',
  ctaLabel = 'Create',
  accent = false,
  autoFocus = true,
  onSubmit,
  onCancel,
}: NoteNameInputProps) {
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)
  const slug = normalizeNoteName(value)
  const invalid = value.trim().length > 0 && slug === null

  const submit = async () => {
    if (!slug || busy) return
    setBusy(true)
    try {
      const created = await onSubmit(slug)
      if (created) setValue('')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="memname">
      <div className="memname__row">
        <input
          className="memname__input mono"
          value={value}
          placeholder={placeholder}
          autoFocus={autoFocus}
          spellCheck={false}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void submit()
            if (e.key === 'Escape') onCancel?.()
          }}
          aria-label="New note name"
          aria-invalid={invalid}
        />
        <button
          className={`btn btn--sm ${accent ? 'btn--accent' : ''}`}
          onClick={() => void submit()}
          disabled={!slug || busy}
        >
          <IconPlus width={12} height={12} /> {ctaLabel}
        </button>
      </div>
      <div className={`memname__hint mono ${invalid ? 'memname__hint--invalid' : ''}`}>
        {invalid
          ? 'letters, digits, dots and dashes only'
          : slug
            ? `→ .cockpit-memory/${slug}.md`
            : 'e.g. “Vision Roadmap” → vision-roadmap.md'}
      </div>
    </div>
  )
}
