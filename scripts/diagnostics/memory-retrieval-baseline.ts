#!/usr/bin/env tsx
import { readFileSync } from 'node:fs'
import {
  evaluateMemoryRetrievalCorpus,
  type MemoryEvalCorpus,
} from '../../shared/memory-eval'

function parseArgs(argv: string[]): { input: string; pretty: boolean } {
  let input = ''
  let pretty = false
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--input') input = argv[++index] ?? ''
    else if (argv[index] === '--pretty') pretty = true
    else throw new Error(`unknown argument: ${argv[index]}`)
  }
  if (!input) throw new Error('--input <json> is required')
  return { input, pretty }
}

try {
  const args = parseArgs(process.argv.slice(2))
  const corpus = JSON.parse(readFileSync(args.input, 'utf8')) as MemoryEvalCorpus
  const report = evaluateMemoryRetrievalCorpus(corpus)
  process.stdout.write(`${JSON.stringify(report, null, args.pretty ? 2 : 0)}\n`)
} catch (error) {
  const message = error instanceof Error ? error.message : 'unknown error'
  process.stderr.write(`memory-retrieval-baseline: ${message}\n`)
  process.exitCode = 1
}
