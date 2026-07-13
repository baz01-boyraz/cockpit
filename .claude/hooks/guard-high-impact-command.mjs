#!/usr/bin/env node

let input
try {
  input = JSON.parse(await new Promise((resolve, reject) => {
    let raw = ''
    process.stdin.setEncoding('utf8')
    process.stdin.on('data', (chunk) => { raw += chunk })
    process.stdin.on('end', () => resolve(raw))
    process.stdin.on('error', reject)
  }))
} catch {
  process.stderr.write('Blocked: malformed lifecycle safety hook input.\n')
  process.exit(2)
}

if (input?.tool_name !== 'Bash') process.exit(0)
const command = String(input?.tool_input?.command ?? '')

const lifecyclePatterns = [
  /\bnpm\s+(?:--[^\s]+\s+)*run\s+app:(?:refresh|install-release)\b/i,
  /\b(?:bash|zsh|sh)\s+[^\n;&|]*(?:refresh-local-app|install-release)\.sh\b/i,
  /\bosascript\b[^\n;&|]*(?:cockpit|com\.boyraz\.cockpit|baz\s+cockpit)[^\n;&|]*\bquit\b/i,
  /\b(?:pkill|killall)\b[^\n;&|]*(?:cockpit|com\.boyraz\.cockpit)/i,
  /\brm\s+(?:-[a-zA-Z]*r[a-zA-Z]*f?|-[a-zA-Z]*f[a-zA-Z]*r)[^\n;&|]*\/(?:Applications|Users\/[^/]+\/Applications)\/[^\n;&|]*cockpit\.app\b/i,
  /\bditto\b[^\n;&|]*\/(?:Applications|Users\/[^/]+\/Applications)\/[^\n;&|]*cockpit\.app\b/i,
]

if (lifecyclePatterns.some((pattern) => pattern.test(command))) {
  process.stderr.write(
    'Blocked app lifecycle command: refresh, quit, restart, or installation requires a current explicit user request and Cockpit UI approval.\n',
  )
  process.exit(2)
}

process.exit(0)
