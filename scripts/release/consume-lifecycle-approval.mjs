#!/usr/bin/env node
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import {
  lstatSync,
  readFileSync,
  realpathSync,
  renameSync,
  unlinkSync,
} from 'node:fs'
import { isAbsolute } from 'node:path'

const expectedAction = process.argv[2]
const approvalFile = process.env.COCKPIT_LIFECYCLE_APPROVAL_FILE ?? ''
const suppliedToken = process.env.COCKPIT_LIFECYCLE_APPROVAL_TOKEN ?? ''
const allowedActions = new Set(['app_refresh', 'app_install_release'])

function refuse(message) {
  process.stderr.write(`[lifecycle-approval] ${message}\n`)
  process.exit(77)
}

if (!allowedActions.has(expectedAction)) refuse('Invalid lifecycle action.')
if (!approvalFile || !suppliedToken || !isAbsolute(approvalFile)) {
  refuse('Missing one-time Cockpit approval; request it from the app UI.')
}

let record
try {
  const stat = lstatSync(approvalFile)
  if (!stat.isFile() || stat.isSymbolicLink()) refuse('Invalid approval record.')
  if (typeof process.getuid === 'function' && stat.uid !== process.getuid()) {
    refuse('Invalid approval record owner.')
  }
  if ((stat.mode & 0o077) !== 0) refuse('Approval record is not private.')
  record = JSON.parse(readFileSync(approvalFile, 'utf8'))
} catch {
  refuse('Approval record is missing, invalid, or already used.')
}

const now = Date.now()
const issuedAt = Date.parse(record?.issuedAt ?? '')
const expiresAt = Date.parse(record?.expiresAt ?? '')
if (!Number.isFinite(issuedAt) || !Number.isFinite(expiresAt) || expiresAt <= now) {
  refuse('One-time Cockpit approval expired.')
}
if (issuedAt > now + 30_000 || expiresAt - issuedAt > 5 * 60_000) {
  refuse('Invalid approval lifetime.')
}

const suppliedHash = createHash('sha256').update(suppliedToken).digest()
let expectedHash
try {
  expectedHash = Buffer.from(record.tokenHash, 'hex')
} catch {
  refuse('Invalid approval record.')
}
if (expectedHash.length !== suppliedHash.length || !timingSafeEqual(expectedHash, suppliedHash)) {
  refuse('Invalid one-time Cockpit approval.')
}

// Claim only after the secret capability matches. rename() is atomic on the
// same filesystem, so concurrent or replayed attempts cannot both proceed.
const claimedFile = `${approvalFile}.consumed-${process.pid}-${randomBytes(4).toString('hex')}`
try {
  renameSync(approvalFile, claimedFile)
} catch {
  refuse('Approval record is missing or already used.')
}

try {
  if (record.version !== 1 || record.action !== expectedAction) {
    refuse('Approval does not authorize this lifecycle action.')
  }
  if (realpathSync(process.cwd()) !== record.sourceDir) {
    refuse('Approval does not authorize this source checkout.')
  }
} finally {
  try {
    unlinkSync(claimedFile)
  } catch {
    // The capability is already spent; cleanup failure must not make it reusable.
  }
}
