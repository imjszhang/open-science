import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'
import { lstat, open, readFile, realpath, rm } from 'node:fs/promises'
import { dirname, isAbsolute, join } from 'node:path'
import { z } from 'zod'
import {
  researchEnvironmentVariableSchema,
  type ResearchExecutionSecretSlot
} from '../../shared/research-execution-profile'
import { writeDurableJsonFile, readDurableJsonFile } from '../storage/durable-json-file'

const digest = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex')
const trialId = z.string().regex(/^[a-z0-9][a-z0-9-]{0,79}$/u)
const count = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER)
const sealSchema = z
  .object({
    studyId: trialId,
    status: z.literal('sealed'),
    unit: z.literal('tokens'),
    totalCeiling: count.positive().max(1_000_000_000),
    allocationPerTrialCeiling: count.positive().max(250_000_000),
    maximumUnitsPerTrial: count.positive().max(250_000_000),
    maxRequestsPerTrial: count.positive().max(6),
    countingPolicy: z.literal('input-plus-output-no-double-count-reasoning-v1'),
    trialIds: z.array(trialId).length(4)
  })
  .passthrough()
export type AcceptanceBudgetSeal = z.infer<typeof sealSchema> & { sha256: string }

/** Test orchestration only: a reviewed token bound, independent of provider prices. */
export async function readAcceptanceBudgetSeal(path: string): Promise<AcceptanceBudgetSeal> {
  try {
    const bytes = await readFile(path)
    const seal = sealSchema.parse(JSON.parse(bytes.toString('utf8')))
    if (
      new Set(seal.trialIds).size !== 4 ||
      seal.maximumUnitsPerTrial > seal.allocationPerTrialCeiling ||
      seal.allocationPerTrialCeiling * 4 > seal.totalCeiling
    )
      throw new Error('invalid allocation')
    return { ...seal, sha256: digest(bytes) }
  } catch {
    // Never relay parsed input or upstream account text into a test log.
    throw new Error(
      'Live acceptance is blocked: the reviewed four-trial token budget is not sealed.'
    )
  }
}

const usageSchema = z
  .object({
    unit: z.literal('tokens'),
    state: z.enum(['unknown', 'partial', 'complete']),
    knownUnits: count.nullable(),
    requestCount: count.nullable(),
    requestsWithUsage: count,
    requestsWithoutUsage: count.nullable()
  })
  .strict()
  .superRefine((usage, ctx) => {
    const invalid = (): void => ctx.addIssue({ code: 'custom', message: 'Invalid usage evidence.' })
    if (usage.requestCount === null || usage.requestsWithoutUsage === null) {
      if (
        usage.state !== 'unknown' ||
        usage.knownUnits !== null ||
        usage.requestsWithUsage !== 0 ||
        usage.requestCount !== null ||
        usage.requestsWithoutUsage !== null
      )
        invalid()
      return
    }
    if (usage.requestsWithUsage + usage.requestsWithoutUsage !== usage.requestCount) invalid()
    if (usage.state === 'unknown') {
      if (usage.knownUnits !== null || usage.requestsWithUsage !== 0) invalid()
    } else if (usage.state === 'partial') {
      if (
        usage.knownUnits === null ||
        usage.requestsWithUsage === 0 ||
        usage.requestsWithoutUsage === 0
      )
        invalid()
    } else if (usage.knownUnits === null || usage.requestsWithoutUsage !== 0) invalid()
  })
export type AcceptanceTrialUsage = z.infer<typeof usageSchema>
const unknownUsage = (): AcceptanceTrialUsage => ({
  unit: 'tokens',
  state: 'unknown',
  knownUnits: null,
  requestCount: null,
  requestsWithUsage: 0,
  requestsWithoutUsage: null
})
const ledgerSchema = z
  .object({
    version: z.literal(2),
    unit: z.literal('tokens'),
    studyId: trialId,
    sealSha256: z.string().regex(/^[a-f0-9]{64}$/u),
    reservations: z
      .array(
        z
          .object({
            trialId,
            maximumUnits: count.positive(),
            reservedAt: z.string(),
            usage: usageSchema,
            usageRecordedAt: z.string().optional()
          })
          .strict()
      )
      .max(4)
  })
  .strict()
type AcceptanceLedger = z.infer<typeof ledgerSchema>

async function withAcceptanceLedger(
  budgetPath: string,
  seal: AcceptanceBudgetSeal,
  operation: (ledger: AcceptanceLedger) => void
): Promise<void> {
  // One ledger beside fixed materials, shared by every output directory and rerun.
  const ledgerPath = join(
    dirname(dirname(await realpath(budgetPath))),
    'live-acceptance-budget-ledger.json'
  )
  const lockPath = ledgerPath + '.lock'
  let lock: Awaited<ReturnType<typeof open>>
  try {
    lock = await open(lockPath, 'wx', 0o600)
  } catch {
    throw new Error(
      'Acceptance budget is locked; reconcile the existing reservation before retrying.'
    )
  }
  try {
    const currentSeal = await readAcceptanceBudgetSeal(budgetPath)
    if (currentSeal.sha256 !== seal.sha256)
      throw new Error('Acceptance budget changed after review.')
    const read = await readDurableJsonFile(
      ledgerPath,
      (text) => ledgerSchema.parse(JSON.parse(text)),
      {},
      { maxBytes: 16384 }
    )
    const ledger: AcceptanceLedger =
      read.status === 'found'
        ? read.value
        : {
            version: 2,
            unit: 'tokens',
            studyId: seal.studyId,
            sealSha256: seal.sha256,
            reservations: []
          }
    if (ledger.studyId !== seal.studyId || ledger.sealSha256 !== seal.sha256)
      throw new Error(
        'Existing budget ledger belongs to another sealed study; operator reconciliation is required.'
      )
    if (
      new Set(ledger.reservations.map((row) => row.trialId)).size !== ledger.reservations.length ||
      ledger.reservations.some(
        (row) =>
          !seal.trialIds.includes(row.trialId) || row.maximumUnits !== seal.maximumUnitsPerTrial
      )
    )
      throw new Error('Existing budget reservations do not match the sealed allocation.')
    operation(ledger)
    await writeDurableJsonFile(ledgerPath, JSON.stringify(ledgerSchema.parse(ledger)))
  } finally {
    await lock.close()
    await rm(lockPath)
  }
}

/** Failed or uncertain trials retain their entire reservation. No automatic retry/refund. */
export async function reserveAcceptanceTrial(
  budgetPath: string,
  seal: AcceptanceBudgetSeal,
  requestedTrial: string
): Promise<void> {
  if (!seal.trialIds.includes(requestedTrial))
    throw new Error('Trial is not in the sealed acceptance budget.')
  await withAcceptanceLedger(budgetPath, seal, (ledger) => {
    if (ledger.reservations.some((row) => row.trialId === requestedTrial))
      throw new Error(
        'This acceptance trial is already reserved; automatic paid retries are forbidden.'
      )
    if (
      ledger.reservations.some(
        (row) =>
          (row.usage.knownUnits !== null && row.usage.knownUnits > row.maximumUnits) ||
          (row.usage.requestCount !== null && row.usage.requestCount > seal.maxRequestsPerTrial)
      )
    )
      throw new Error('Observed usage exceeded its reviewed bound; further trials are blocked.')
    if (
      ledger.reservations.reduce((total, row) => total + row.maximumUnits, 0) +
        seal.maximumUnitsPerTrial >
      seal.totalCeiling
    )
      throw new Error('Acceptance budget ceiling exceeded.')
    ledger.reservations.push({
      trialId: requestedTrial,
      maximumUnits: seal.maximumUnitsPerTrial,
      reservedAt: new Date().toISOString(),
      usage: unknownUsage()
    })
  })
}

/** Actual reported usage is evidence only. Partial, zero or missing usage never refunds a slot. */
export async function recordAcceptanceTrialUsage(
  budgetPath: string,
  seal: AcceptanceBudgetSeal,
  requestedTrial: string,
  value: AcceptanceTrialUsage
): Promise<void> {
  const usage = usageSchema.parse(value)
  await withAcceptanceLedger(budgetPath, seal, (ledger) => {
    const row = ledger.reservations.find((entry) => entry.trialId === requestedTrial)
    if (!row) throw new Error('Usage cannot be attached to an unreserved trial.')
    if (row.usageRecordedAt) {
      if (JSON.stringify(row.usage) !== JSON.stringify(usage))
        throw new Error('Conflicting terminal usage evidence; operator reconciliation is required.')
      return
    }
    row.usage = usage
    row.usageRecordedAt = new Date().toISOString()
  })
}

/** Reads explicitly selected slots, never merges .env into the runner/child process environment. */
export async function readAcceptanceCredentials(
  path: string,
  slots: readonly ResearchExecutionSecretSlot[]
): Promise<Record<string, string>> {
  if (!isAbsolute(path))
    throw new Error('Acceptance credentials require an explicit absolute local file path.')
  const info = await lstat(path)
  if (!info.isFile() || info.isSymbolicLink() || info.size > 1024 * 1024)
    throw new Error('Acceptance credential file is unavailable.')
  const wanted = new Map(
    slots.map((slot) => [
      researchEnvironmentVariableSchema.parse(slot.environmentVariable),
      slot.key
    ])
  )
  const credentials: Record<string, string> = {}
  const bytes = await readFile(path)
  try {
    for (const line of bytes.toString('utf8').split(/\r?\n/u)) {
      const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/u.exec(line.trim())
      if (!match || !wanted.has(match[1])) continue
      let value = match[2].trim()
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      )
        value = value.slice(1, -1)
      else value = value.replace(/\s+#.*$/u, '').trim()
      if (!value || value.includes('\0') || value.includes('\n') || value.length > 16_384)
        throw new Error('A required local credential is invalid.')
      const key = wanted.get(match[1])!
      if (key in credentials)
        throw new Error('The local credential file contains an ambiguous slot.')
      credentials[key] = value
    }
    if (slots.some((slot) => slot.required && !credentials[slot.key]))
      throw new Error('A required local credential is missing.')
    return credentials
  } catch {
    for (const key of Object.keys(credentials)) delete credentials[key]
    throw new Error('Acceptance credential slots could not be read; no secret values were logged.')
  } finally {
    bytes.fill(0)
  }
}

/** Test-only encryption; exercises the production store/lease path without claiming OS-vault UI coverage. */
export function ephemeralAcceptanceCipher(): {
  encrypt(value: string): string
  decrypt(ref: string): string
  destroy(): void
} {
  const key = randomBytes(32)
  let destroyed = false
  return {
    encrypt(value) {
      if (destroyed) throw new Error('Acceptance cipher is closed.')
      const iv = randomBytes(12),
        cipher = createCipheriv('aes-256-gcm', key, iv)
      const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()])
      return 'enc:' + Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString('base64')
    },
    decrypt(ref) {
      if (destroyed || !ref.startsWith('enc:')) throw new Error('Acceptance cipher is unavailable.')
      const bytes = Buffer.from(ref.slice(4), 'base64')
      const cipher = createDecipheriv('aes-256-gcm', key, bytes.subarray(0, 12))
      cipher.setAuthTag(bytes.subarray(12, 28))
      return Buffer.concat([cipher.update(bytes.subarray(28)), cipher.final()]).toString('utf8')
    },
    destroy() {
      key.fill(0)
      destroyed = true
    }
  }
}
