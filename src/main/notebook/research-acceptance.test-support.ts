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
const sealSchema = z
  .object({
    studyId: trialId,
    status: z.literal('sealed'),
    currency: z.literal('CNY'),
    totalCeiling: z.number().positive().max(100),
    allocationPerTrialCeiling: z.number().positive().max(25),
    maximumCostPerTrialCny: z.number().positive().max(25),
    providerRatesVerified: z.literal(true),
    verifiedRateSources: z.array(z.string().trim().min(1)).min(1),
    trialIds: z.array(trialId).length(4)
  })
  .passthrough()
export type AcceptanceBudgetSeal = z.infer<typeof sealSchema> & { sha256: string }

/** Test orchestration only. This is an operator-sealed price ceiling, not a price estimator. */
export async function readAcceptanceBudgetSeal(path: string): Promise<AcceptanceBudgetSeal> {
  try {
    const bytes = await readFile(path)
    const seal = sealSchema.parse(JSON.parse(bytes.toString('utf8')))
    if (
      new Set(seal.trialIds).size !== 4 ||
      seal.maximumCostPerTrialCny > seal.allocationPerTrialCeiling ||
      seal.allocationPerTrialCeiling * 4 > seal.totalCeiling
    )
      throw new Error('invalid allocation')
    return { ...seal, sha256: digest(bytes) }
  } catch {
    // Never relay parsed input or upstream price/account text into a test log.
    throw new Error('Live acceptance is blocked: the reviewed four-trial CNY budget is not sealed.')
  }
}
const ledgerSchema = z
  .object({
    version: z.literal(1),
    studyId: trialId,
    sealSha256: z.string().regex(/^[a-f0-9]{64}$/u),
    reservations: z
      .array(
        z
          .object({ trialId, maximumCostCny: z.number().positive(), reservedAt: z.string() })
          .strict()
      )
      .max(4)
  })
  .strict()

/** Failed or uncertain trials retain their entire reservation. No automatic retry/refund. */
export async function reserveAcceptanceTrial(
  budgetPath: string,
  seal: AcceptanceBudgetSeal,
  requestedTrial: string
): Promise<void> {
  if (!seal.trialIds.includes(requestedTrial))
    throw new Error('Trial is not in the sealed acceptance budget.')
  // One ledger beside the fixed materials folder, shared by every output directory and rerun.
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
    const ledger =
      read.status === 'found'
        ? read.value
        : {
            version: 1 as const,
            studyId: seal.studyId,
            sealSha256: seal.sha256,
            reservations: [] as z.infer<typeof ledgerSchema>['reservations']
          }
    if (ledger.studyId !== seal.studyId || ledger.sealSha256 !== seal.sha256)
      throw new Error(
        'Existing budget ledger belongs to another sealed study; operator reconciliation is required.'
      )
    if (
      new Set(ledger.reservations.map((row) => row.trialId)).size !== ledger.reservations.length ||
      ledger.reservations.some(
        (row) =>
          !seal.trialIds.includes(row.trialId) || row.maximumCostCny !== seal.maximumCostPerTrialCny
      )
    )
      throw new Error('Existing budget reservations do not match the sealed allocation.')
    if (ledger.reservations.some((row) => row.trialId === requestedTrial))
      throw new Error(
        'This acceptance trial is already reserved; automatic paid retries are forbidden.'
      )
    if (
      ledger.reservations.reduce((total, row) => total + row.maximumCostCny, 0) +
        seal.maximumCostPerTrialCny >
      seal.totalCeiling
    )
      throw new Error('Acceptance budget ceiling exceeded.')
    ledger.reservations.push({
      trialId: requestedTrial,
      maximumCostCny: seal.maximumCostPerTrialCny,
      reservedAt: new Date().toISOString()
    })
    await writeDurableJsonFile(ledgerPath, JSON.stringify(ledgerSchema.parse(ledger)))
  } finally {
    await lock.close()
    await rm(lockPath)
  }
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
