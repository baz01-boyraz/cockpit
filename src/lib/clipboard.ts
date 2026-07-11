export interface ClipboardPort {
  writeText(text: string): Promise<void>
}

export interface ClipboardEnvironment {
  clipboard?: ClipboardPort | null
  fallback(text: string): boolean
}

function textareaFallback(text: string): boolean {
  if (typeof document === 'undefined') return false
  const scratch = document.createElement('textarea')
  scratch.value = text
  scratch.readOnly = true
  scratch.tabIndex = -1
  scratch.setAttribute('aria-hidden', 'true')
  scratch.style.position = 'fixed'
  scratch.style.left = '-9999px'
  scratch.style.top = '0'
  scratch.style.opacity = '0'
  scratch.style.pointerEvents = 'none'
  document.body.appendChild(scratch)
  scratch.focus()
  scratch.select()
  try {
    return document.execCommand('copy')
  } finally {
    document.body.removeChild(scratch)
  }
}

function browserEnvironment(): ClipboardEnvironment {
  return {
    clipboard: typeof navigator === 'undefined' ? null : navigator.clipboard,
    fallback: textareaFallback,
  }
}

/** Clipboard API first, then the proven hidden-textarea fallback. Never throws. */
export async function copyText(
  text: string,
  environment: ClipboardEnvironment = browserEnvironment(),
): Promise<boolean> {
  if (!text) return false
  if (environment.clipboard) {
    try {
      await environment.clipboard.writeText(text)
      return true
    } catch {
      // Denied/unavailable Clipboard API falls through to the DOM path.
    }
  }
  try {
    return environment.fallback(text)
  } catch {
    return false
  }
}
