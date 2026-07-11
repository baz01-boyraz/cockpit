/** Trigger a local UTF-8 text download without sending content outside the renderer. */
export function downloadTextFile(filename: string, text: string): boolean {
  if (!filename || !text || typeof document === 'undefined' || typeof URL === 'undefined') {
    return false
  }
  const url = URL.createObjectURL(new Blob([text], { type: 'text/markdown;charset=utf-8' }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.hidden = true
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  window.setTimeout(() => URL.revokeObjectURL(url), 0)
  return true
}
