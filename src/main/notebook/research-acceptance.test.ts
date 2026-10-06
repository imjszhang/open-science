import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { ResearchExecutionProfileStore } from '../research-execution-profiles/store'
import {
  ephemeralAcceptanceCipher,
  readAcceptanceBudgetSeal,
  readAcceptanceCredentials,
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
  currency: 'CNY',
  totalCeiling: 100,
  allocationPerTrialCeiling: 25,
  maximumCostPerTrialCny: 25,
  providerRatesVerified: true,
  verifiedRateSources: ['reviewed-fixture-rates'],
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
  { status: 'pending-relay-price-verification' },
  { providerRatesVerified: false },
  { maximumCostPerTrialCny: null },
  { verifiedRateSources: [] },
  { totalCeiling: 101 },
  { maximumCostPerTrialCny: 26 },
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
      (sum: number, row: { maximumCostCny: number }) => sum + row.maximumCostCny,
      0
    )
  ).toBe(100)
})
it('refuses concurrent or changed-budget admission without resetting prior spend', async () => {
  const f = await fixture(),
    seal = await readAcceptanceBudgetSeal(f.budgetPath)
  const concurrent = await Promise.allSettled([
    reserveAcceptanceTrial(f.budgetPath, seal, 'author'),
    reserveAcceptanceTrial(f.budgetPath, seal, 'author')
  ])
  expect(concurrent.filter((row) => row.status === 'fulfilled')).toHaveLength(1)
  await writeFile(f.budgetPath, JSON.stringify({ ...sealed, maximumCostPerTrialCny: 20 }))
  const changed = await readAcceptanceBudgetSeal(f.budgetPath)
  await expect(reserveAcceptanceTrial(f.budgetPath, changed, 'external')).rejects.toThrow(
    'another sealed study'
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
