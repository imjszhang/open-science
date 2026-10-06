import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { ResearchExecutionProfileStore } from '../research-execution-profiles/store'
import {
  ephemeralAcceptanceCipher,
  readAcceptanceBudgetSeal,
  readAcceptanceCredentials,
  recordAcceptanceTrialUsage,
  reserveAcceptanceTrial
} from './research-acceptance.test-support'
vi.mock('electron', () => ({ safeStorage: { isEncryptionAvailable: () => false } }))
const roots: string[] = []
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { force: true, recursive: true })
})
const sealed = {
  studyId: 'acceptance',
  status: 'sealed',
  unit: 'tokens',
  totalCeiling: 1_000_000_000,
  allocationPerTrialCeiling: 250_000_000,
  maximumUnitsPerTrial: 250_000_000,
  maxRequestsPerTrial: 6,
  countingPolicy: 'input-plus-output-no-double-count-reasoning-v1',
  trialIds: ['author', 'external', 'ordinary', 'fork']
}
async function fixture(): Promise<{ root: string; budgetPath: string }> {
  const root = await mkdtemp(join(tmpdir(), 'research-acceptance-budget-'))
  roots.push(root)
  await mkdir(join(root, 'materials'))
  const budgetPath = join(root, 'materials', 'budget.json')
  await writeFile(budgetPath, JSON.stringify(sealed))
  return { root, budgetPath }
}
it.each([
  { status: 'pending' },
  { unit: 'CNY' },
  { maximumUnitsPerTrial: null },
  { countingPolicy: 'unknown' },
  { totalCeiling: 1_000_000_001 },
  { maximumUnitsPerTrial: 250_000_001 },
  { maxRequestsPerTrial: 7 },
  { totalCeiling: 999_999_999 },
  { maximumUnitsPerTrial: 0.5 },
  { trialIds: ['author', 'author', 'ordinary', 'fork'] }
])('blocks an unsealed or unsafe budget before any credential access: %j', async (change) => {
  const f = await fixture()
  await writeFile(f.budgetPath, JSON.stringify({ ...sealed, ...change }))
  await expect(readAcceptanceBudgetSeal(f.budgetPath)).rejects.toThrow('not sealed')
  await expect(readFile(join(f.root, 'live-acceptance-budget-ledger.json'))).rejects.toMatchObject({
    code: 'ENOENT'
  })
})
it('reserves each of four trials once, across reruns, with failures never freeing spend', async () => {
  const f = await fixture(),
    seal = await readAcceptanceBudgetSeal(f.budgetPath)
  for (const id of sealed.trialIds) await reserveAcceptanceTrial(f.budgetPath, seal, id)
  for (const id of sealed.trialIds)
    await expect(reserveAcceptanceTrial(f.budgetPath, seal, id)).rejects.toThrow('already reserved')
  await expect(reserveAcceptanceTrial(f.budgetPath, seal, 'extra')).rejects.toThrow('not in')
  const ledger = JSON.parse(
    await readFile(join(f.root, 'live-acceptance-budget-ledger.json'), 'utf8')
  )
  expect(
    ledger.reservations.reduce(
      (sum: number, row: { maximumUnits: number }) => sum + row.maximumUnits,
      0
    )
  ).toBe(1_000_000_000)
})
it('reserves the reviewed workload bound rather than treating the billion-token cap as expected usage', async () => {
  const f = await fixture()
  await writeFile(f.budgetPath, JSON.stringify({ ...sealed, maximumUnitsPerTrial: 12_582_912 }))
  const seal = await readAcceptanceBudgetSeal(f.budgetPath)
  for (const id of sealed.trialIds) await reserveAcceptanceTrial(f.budgetPath, seal, id)
  const ledger = JSON.parse(
    await readFile(join(f.root, 'live-acceptance-budget-ledger.json'), 'utf8')
  )
  expect(
    ledger.reservations.reduce(
      (sum: number, row: { maximumUnits: number }) => sum + row.maximumUnits,
      0
    )
  ).toBe(50_331_648)
  expect(
    ledger.reservations.every(
      (row: { usage: { knownUnits: number | null } }) => row.usage.knownUnits === null
    )
  ).toBe(true)
})
it('refuses concurrent or changed-budget admission without resetting prior spend', async () => {
  const f = await fixture(),
    seal = await readAcceptanceBudgetSeal(f.budgetPath)
  const concurrent = await Promise.allSettled([
    reserveAcceptanceTrial(f.budgetPath, seal, 'author'),
    reserveAcceptanceTrial(f.budgetPath, seal, 'author')
  ])
  expect(concurrent.filter((row) => row.status === 'fulfilled')).toHaveLength(1)
  await writeFile(f.budgetPath, JSON.stringify({ ...sealed, maximumUnitsPerTrial: 20 }))
  const changed = await readAcceptanceBudgetSeal(f.budgetPath)
  await expect(reserveAcceptanceTrial(f.budgetPath, changed, 'external')).rejects.toThrow(
    'another sealed study'
  )
})
it('retains unknown usage and a full reservation after a failed or uncertain attempt', async () => {
  const f = await fixture(),
    seal = await readAcceptanceBudgetSeal(f.budgetPath)
  await reserveAcceptanceTrial(f.budgetPath, seal, 'author')
  const ledger = JSON.parse(
    await readFile(join(f.root, 'live-acceptance-budget-ledger.json'), 'utf8')
  )
  expect(ledger.reservations[0]).toMatchObject({
    maximumUnits: 250_000_000,
    usage: {
      unit: 'tokens',
      state: 'unknown',
      knownUnits: null,
      requestCount: null,
      requestsWithUsage: 0,
      requestsWithoutUsage: null
    }
  })
  await expect(reserveAcceptanceTrial(f.budgetPath, seal, 'author')).rejects.toThrow(
    'already reserved'
  )
})
it('records partial and explicit zero-request evidence without refunding or inventing missing usage', async () => {
  const f = await fixture(),
    seal = await readAcceptanceBudgetSeal(f.budgetPath)
  await reserveAcceptanceTrial(f.budgetPath, seal, 'author')
  const partial = {
    unit: 'tokens' as const,
    state: 'partial' as const,
    knownUnits: 31,
    requestCount: 2,
    requestsWithUsage: 1,
    requestsWithoutUsage: 1
  }
  await recordAcceptanceTrialUsage(f.budgetPath, seal, 'author', partial)
  await recordAcceptanceTrialUsage(f.budgetPath, seal, 'author', partial)
  await expect(
    recordAcceptanceTrialUsage(f.budgetPath, seal, 'author', { ...partial, knownUnits: 32 })
  ).rejects.toThrow('Conflicting')
  await reserveAcceptanceTrial(f.budgetPath, seal, 'ordinary')
  await recordAcceptanceTrialUsage(f.budgetPath, seal, 'ordinary', {
    unit: 'tokens',
    state: 'complete',
    knownUnits: 0,
    requestCount: 0,
    requestsWithUsage: 0,
    requestsWithoutUsage: 0
  })
  const ledger = JSON.parse(
    await readFile(join(f.root, 'live-acceptance-budget-ledger.json'), 'utf8')
  )
  expect(ledger.reservations.map((row: { maximumUnits: number }) => row.maximumUnits)).toEqual([
    250_000_000, 250_000_000
  ])
  expect(ledger.reservations[0].usage).toEqual(partial)
  await expect(reserveAcceptanceTrial(f.budgetPath, seal, 'ordinary')).rejects.toThrow(
    'already reserved'
  )
})
it.each([
  {
    unit: 'tokens',
    state: 'unknown',
    knownUnits: 0,
    requestCount: 1,
    requestsWithUsage: 0,
    requestsWithoutUsage: 1
  },
  {
    unit: 'tokens',
    state: 'complete',
    knownUnits: 0,
    requestCount: 1,
    requestsWithUsage: 0,
    requestsWithoutUsage: 1
  },
  {
    unit: 'tokens',
    state: 'partial',
    knownUnits: 10,
    requestCount: 1,
    requestsWithUsage: 1,
    requestsWithoutUsage: 1
  }
])('rejects contradictory usage without mutating the reservation: %j', async (usage) => {
  const f = await fixture(),
    seal = await readAcceptanceBudgetSeal(f.budgetPath)
  await reserveAcceptanceTrial(f.budgetPath, seal, 'author')
  const path = join(f.root, 'live-acceptance-budget-ledger.json'),
    before = await readFile(path, 'utf8')
  await expect(
    recordAcceptanceTrialUsage(
      f.budgetPath,
      seal,
      'author',
      usage as Parameters<typeof recordAcceptanceTrialUsage>[3]
    )
  ).rejects.toThrow()
  expect(await readFile(path, 'utf8')).toBe(before)
})
it.each([
  { knownUnits: 250_000_001, requestCount: 1, requestsWithUsage: 1 },
  { knownUnits: 30, requestCount: 7, requestsWithUsage: 7 }
])('retains observed overrun evidence and blocks further trials: %j', async (actual) => {
  const f = await fixture(),
    seal = await readAcceptanceBudgetSeal(f.budgetPath)
  await reserveAcceptanceTrial(f.budgetPath, seal, 'author')
  await recordAcceptanceTrialUsage(f.budgetPath, seal, 'author', {
    unit: 'tokens',
    state: 'complete',
    requestsWithoutUsage: 0,
    ...actual
  })
  await expect(reserveAcceptanceTrial(f.budgetPath, seal, 'external')).rejects.toThrow(
    'exceeded its reviewed bound'
  )
})
it.each(['corrupt', 'old-currency', 'changed-reservation'])(
  'fails closed for a tampered ledger: %s',
  async (mode) => {
    const f = await fixture(),
      seal = await readAcceptanceBudgetSeal(f.budgetPath)
    await reserveAcceptanceTrial(f.budgetPath, seal, 'author')
    const path = join(f.root, 'live-acceptance-budget-ledger.json')
    const ledger = JSON.parse(await readFile(path, 'utf8'))
    if (mode === 'old-currency') ledger.version = 1
    if (mode === 'changed-reservation') ledger.reservations[0].maximumUnits = 1
    const bytes = mode === 'corrupt' ? '{' : JSON.stringify(ledger)
    await writeFile(path, bytes)
    await expect(reserveAcceptanceTrial(f.budgetPath, seal, 'external')).rejects.toThrow()
    expect(await readFile(path, 'utf8')).toBe(bytes)
  }
)
it('rejects a changed seal after it was read and does not attach usage to an unreserved trial', async () => {
  const f = await fixture(),
    seal = await readAcceptanceBudgetSeal(f.budgetPath)
  await expect(
    recordAcceptanceTrialUsage(f.budgetPath, seal, 'author', {
      unit: 'tokens',
      state: 'unknown',
      knownUnits: null,
      requestCount: null,
      requestsWithUsage: 0,
      requestsWithoutUsage: null
    })
  ).rejects.toThrow('unreserved')
  await writeFile(f.budgetPath, JSON.stringify({ ...sealed, maximumUnitsPerTrial: 100 }))
  await expect(reserveAcceptanceTrial(f.budgetPath, seal, 'author')).rejects.toThrow(
    'changed after review'
  )
})
it('uses only selected slots through production encrypted profile save/lease, keeping the key ephemeral', async () => {
  const f = await fixture(),
    cipher = ephemeralAcceptanceCipher()
  const slots = [
    {
      key: 'provider',
      description: 'Provider',
      environmentVariable: 'ACCEPTANCE_API_KEY',
      required: true
    }
  ]
  const env = join(f.root, '.env')
  await writeFile(
    env,
    'UNRELATED_KEY=not-selected\nACCEPTANCE_API_KEY="synthetic-credential-for-local-test"\n'
  )
  const credentials = await readAcceptanceCredentials(env, slots)
  const binding = {
    projectId: 'project',
    sourceSessionId: 'source',
    sourceIdentity: 'source-identity',
    descriptorVersionId: 'descriptor',
    descriptorSha256: 'a'.repeat(64),
    planKey: 'trial'
  }
  const store = new ResearchExecutionProfileStore(join(f.root, 'isolated-config'), cipher)
  const profile = await store.save(
    { ...binding, sessionId: 'ordinary', displayName: 'Isolated acceptance', credentials },
    binding,
    slots
  )
  for (const key of Object.keys(credentials)) delete credentials[key]
  const encoded = await readFile(
    join(f.root, 'isolated-config', 'research-execution-profiles.json'),
    'utf8'
  )
  expect(encoded.includes('synthetic-credential-for-local-test')).toBe(false)
  expect(encoded.includes('not-selected')).toBe(false)
  const lease = await store.lease(profile.profileId, binding, slots)
  expect(Object.keys(lease.privateEnvironment)).toEqual(['ACCEPTANCE_API_KEY'])
  expect(
    lease.privateEnvironment.ACCEPTANCE_API_KEY === 'synthetic-credential-for-local-test'
  ).toBe(true)
  lease.release()
  expect(lease.privateEnvironment).toEqual({})
  cipher.destroy()
  await expect(store.lease(profile.profileId, binding, slots)).rejects.toThrow('unavailable')
})
