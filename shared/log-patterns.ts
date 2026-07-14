/**
 * Error intelligence pattern matchers (pure, testable).
 *
 * Given a line (or chunk) of terminal/log output, detect well-known failure
 * shapes and produce a structured insight: likely cause, suggested action, and
 * which agent is best suited to fix it. This is deliberately rule-based for v1 —
 * cheap, deterministic, and good enough to be useful before any LLM is involved.
 */
import type { AgentType, ErrorSeverity } from './domain'
import { isNonActionableLogLine } from './log-sanitize'

export interface PatternMatch {
  pattern: string
  title: string
  likelyCause: string
  suggestedAction: string
  suggestedAgent: AgentType
  severity: ErrorSeverity
}

interface PatternDef extends Omit<PatternMatch, 'pattern'> {
  id: string
  test: RegExp
}

const PATTERNS: PatternDef[] = [
  {
    id: 'module_not_found',
    test: /(Cannot find module|Module not found|ERR_MODULE_NOT_FOUND|ModuleNotFoundError)/i,
    title: 'Missing module',
    likelyCause: 'A required package or local import path is not installed or is misspelled.',
    suggestedAction: 'Run the install command (npm/pnpm/yarn install) or fix the import path.',
    suggestedAgent: 'codex',
    severity: 'high',
  },
  {
    id: 'port_in_use',
    test: /(EADDRINUSE|address already in use|port \d+ is (already )?in use)/i,
    title: 'Port already in use',
    likelyCause: 'Another process is already bound to the dev/server port.',
    suggestedAction: 'Stop the other process or start the server on a different port.',
    suggestedAgent: 'local',
    severity: 'medium',
  },
  {
    id: 'ts_error',
    test: /\bTS\d{3,5}\b|error TS\d+/,
    title: 'TypeScript error',
    likelyCause: 'A type error is blocking compilation.',
    suggestedAction: 'Open the reported file:line and reconcile the types, or run the typechecker.',
    suggestedAgent: 'claude',
    severity: 'high',
  },
  {
    id: 'build_failed',
    test: /(build failed|Failed to compile|compilation failed|webpack.*error)/i,
    title: 'Build failed',
    likelyCause: 'The bundler/compiler rejected the current source.',
    suggestedAction: 'Inspect the first error in the build output and resolve it before retrying.',
    suggestedAgent: 'codex',
    severity: 'high',
  },
  {
    id: 'dependency_missing',
    test: /(npm ERR!|peer dep|ERESOLVE|could not resolve dependency|unmet peer dependency)/i,
    title: 'Dependency resolution problem',
    likelyCause: 'A dependency tree conflict or a missing/incompatible package version.',
    suggestedAction: 'Review the dependency conflict; align versions or reinstall the lockfile.',
    suggestedAgent: 'local',
    severity: 'medium',
  },
  {
    id: 'eslint_error',
    test: /✖ \d+ problems?|eslint.*error|Parsing error:/i,
    title: 'Lint error',
    likelyCause: 'ESLint reported one or more errors.',
    suggestedAction: 'Run the linter with --fix where possible, then address remaining errors.',
    suggestedAgent: 'codex',
    severity: 'low',
  },
  {
    id: 'deploy_failed',
    // A generic "service crashed" is not deployment evidence. Electron emits
    // exactly that phrase when Chromium's network helper restarts itself; the
    // old broad branch turned a recovered local subprocess into a Railway
    // incident. Require deploy/provider context so Sentinel stays trustworthy.
    test: /(deploy(?:ment)?\s+(?:failed|crashed)|railway.*(?:error|failed|crashed)|(?:build|service)\s+crashed.*\bdeploy(?:ment)?\b)/i,
    title: 'Deployment problem',
    likelyCause: 'A deploy or service on the infrastructure provider failed or crashed.',
    suggestedAction: 'Check the configured deployment provider logs before retrying or redeploying.',
    suggestedAgent: 'local',
    severity: 'high',
  },
  {
    id: 'unhandled_rejection',
    test: /(UnhandledPromiseRejection|Uncaught \(in promise\)|FATAL ERROR|segmentation fault)/i,
    title: 'Unhandled runtime failure',
    likelyCause: 'An exception escaped to the top level and may have crashed the process.',
    suggestedAction: 'Trace the stack to the throwing call and add handling or fix the root cause.',
    suggestedAgent: 'claude',
    severity: 'critical',
  },
]

/** Return the first matching pattern for a line, or null. */
export function matchLogLine(line: string): PatternMatch | null {
  if (isNonActionableLogLine(line)) return null
  for (const p of PATTERNS) {
    if (p.test.test(line)) {
      return {
        pattern: p.id,
        title: p.title,
        likelyCause: p.likelyCause,
        suggestedAction: p.suggestedAction,
        suggestedAgent: p.suggestedAgent,
        severity: p.severity,
      }
    }
  }
  return null
}

// Real failure markers (word-boundary tokens plus a few non-word glyphs).
const ERROR_TOKENS = /\b(error|err!|fatal|exception|failed|panic)\b|[✖✗]/i
const WARN_TOKENS = /\b(warn|warning|deprecated)\b|[⚠]/i
const DEBUG_TOKENS = /\b(debug|trace|verbose)\b/i
// Success/clean-result lines that merely mention "warning"/"error" as a count
// (e.g. "lint (0 warnings)", "✓ build", "0 errors"). These are not problems.
const SUCCESS_LINE = /(^|\s)0\s+(errors?|warnings?|problems?)\b|[✓✔✅]/u

/** Classify a single line's log level from its content. */
export function inferLogLevel(line: string): 'debug' | 'info' | 'warn' | 'error' {
  // A success marker with no genuine failure token is informational, not a warn.
  if (SUCCESS_LINE.test(line) && !ERROR_TOKENS.test(line)) return 'info'
  if (ERROR_TOKENS.test(line)) return 'error'
  if (WARN_TOKENS.test(line)) return 'warn'
  if (DEBUG_TOKENS.test(line)) return 'debug'
  return 'info'
}
