import { extractHook, HOOK_CAP } from './memory-hub'
import { reviewOperation, type ReviewItem } from './memory-review'

export type MemoryReviewCategory = 'cleanup' | 'attention' | 'suggestion'

export interface MemoryReviewPresentation {
  category: MemoryReviewCategory
  eyebrow: string
  title: string
  summary: string
  rationale: string
  /** One line of what the note actually says — so a decision never needs the raw text. */
  hook: string | null
  acceptLabel: string
  discardLabel: string
  canEdit: boolean
}

const heading = (content: string | null): string | null => {
  if (!content) return null
  const match = /^#\s+(.+?)\s*$/m.exec(content)
  return match?.[1]?.trim() || null
}

export function humanizeMemoryName(name: string): string {
  const words = name.replace(/[-_.]+/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase()
  return words ? words[0].toUpperCase() + words.slice(1) : 'Untitled memory'
}

const noteName = (item: ReviewItem): string =>
  heading(item.existingContent) ?? heading(item.proposedContent) ?? humanizeMemoryName(item.slug)

const noteHook = (item: ReviewItem): string | null => {
  const source = item.existingContent ?? item.proposedContent
  const hook = source ? extractHook(source) : null
  if (!hook) return null
  // extractHook slices at the cap — a full-length hook is almost surely cut.
  return hook.length >= HOOK_CAP ? `${hook}…` : hook
}

/** Pipeline phrasing that must never reach the owner's card verbatim. */
const PIPELINE_NOISE = /model confidence|reconcile=|semantic gate|charter gate/i

/**
 * Turn the queue's stored reason into an owner-facing sentence: strip the
 * curation/trust-policy prefixes, then fall back to `fallback` when nothing
 * human-readable remains.
 */
function humanReviewReason(raw: string | null | undefined, fallback: string): string {
  if (!raw) return fallback
  const stripped = raw
    .trim()
    .replace(/^curation\s*[—-]\s*(archive|merge):\s*/i, '')
    .replace(/^(autopilot|assisted|manual) policy requires review for a \w+ proposal\.\s*/i, '')
    .trim()
  if (!stripped || PIPELINE_NOISE.test(stripped)) return fallback
  const sentence = stripped[0].toUpperCase() + stripped.slice(1)
  return /[.!?…]$/.test(sentence) ? sentence : `${sentence}.`
}

export function presentMemoryReview(item: ReviewItem): MemoryReviewPresentation {
  const operation = reviewOperation(item)
  const hook = noteHook(item)

  if (operation === 'archive') {
    return {
      category: 'cleanup',
      eyebrow: 'Cleanup suggestion',
      title: `Archive “${noteName(item)}”?`,
      summary: 'It has stopped earning its place in everyday memory. Archiving tucks it away — recoverable anytime.',
      rationale: humanReviewReason(
        item.reason,
        'The weekly tidy-up marked this memory as old or no longer active.',
      ),
      hook,
      acceptLabel: 'Archive note',
      discardLabel: 'Keep it active',
      canEdit: false,
    }
  }

  if (operation === 'merge') {
    const duplicate = humanizeMemoryName(item.alsoTrash ?? 'duplicate memory')
    return {
      category: 'cleanup',
      eyebrow: 'Duplicate cleanup',
      title: `Combine “${duplicate}” with “${noteName(item)}”?`,
      summary: 'They appear to repeat the same idea. Combining them leaves one cleaner memory and keeps the history.',
      rationale: humanReviewReason(
        item.reason,
        'The weekly tidy-up found the same idea saved in two places.',
      ),
      hook,
      acceptLabel: 'Combine notes',
      discardLabel: 'Keep both',
      canEdit: false,
    }
  }

  if (item.kind === 'conflict') {
    return {
      category: 'attention',
      eyebrow: 'Needs attention',
      title: 'Two versions need a decision',
      summary: `Memory already contains a different version of “${noteName(item)}”. Nothing was overwritten. Hermes can settle it when the evidence is clear; otherwise you choose.`,
      rationale: 'The saved fact and a new observation disagree, so neither version was chosen automatically.',
      hook,
      acceptLabel: 'Use new version',
      discardLabel: 'Keep current version',
      canEdit: true,
    }
  }

  if (item.kind === 'merge') {
    return {
      category: 'suggestion',
      eyebrow: 'New detail',
      title: `Update “${noteName(item)}”?`,
      summary: 'A recent session found a useful detail that can be added to this memory.',
      rationale: humanReviewReason(
        item.reason,
        'A recent session found a detail that belongs with this memory.',
      ),
      hook,
      acceptLabel: 'Add detail',
      discardLabel: 'Skip it',
      canEdit: true,
    }
  }

  return {
    category: 'suggestion',
    eyebrow: 'Possible memory',
    title: `Remember “${noteName(item)}”?`,
    summary: 'A recent session found something that may be useful again later.',
    rationale: humanReviewReason(
      item.reason,
      'A recent session marked this as useful beyond the current conversation.',
    ),
    hook,
    acceptLabel: 'Remember this',
    discardLabel: 'Not useful',
    canEdit: true,
  }
}

export function isBatchCleanup(item: ReviewItem): boolean {
  return item.kind === 'maintenance' && reviewOperation(item) !== null
}

export interface MemoryReviewSummary {
  cleanup: number
  attention: number
  suggestions: number
}

export function summarizeMemoryReviews(items: ReviewItem[]): MemoryReviewSummary {
  return items.reduce<MemoryReviewSummary>(
    (counts, item) => {
      const category = presentMemoryReview(item).category
      if (category === 'suggestion') counts.suggestions += 1
      else counts[category] += 1
      return counts
    },
    { cleanup: 0, attention: 0, suggestions: 0 },
  )
}
