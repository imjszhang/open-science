import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { createProjectDbClient } from '../projects/prisma-client'
import { migrateApplicationDatabase } from './migration-service'

it('adds nullable research projections without changing existing Session identities or archive state', async () => {
  const root = await mkdtemp(join(tmpdir(), 'research-membership-migration-'))
  const client = createProjectDbClient(root)
  try {
    await migrateApplicationDatabase(client)
    await client.project.create({ data: { id: 'p', name: 'Project' } })
    await client.session.create({
      data: {
        id: 's',
        number: 1,
        projectId: 'p',
        title: 'Historical discussion',
        status: 'idle',
        presentedStatus: 'idle',
        archivedAtMs: 3n,
        revision: 5n,
        createdAtMs: 1n,
        updatedAtMs: 2n
      }
    })
    const before = await client.session.findUnique({ where: { id: 's' } })
    await client.$executeRawUnsafe('ALTER TABLE "Session" DROP COLUMN "researchMembershipJson"')
    await client.$executeRawUnsafe('ALTER TABLE "Session" DROP COLUMN "importedResearchId"')
    await client.$executeRawUnsafe(
      "DELETE FROM _open_science_migrations WHERE id = '0050_session_research_membership'"
    )
    await expect(
      migrateApplicationDatabase(client, { databasePath: join(root, 'open-science.db') })
    ).resolves.toMatchObject({ applied: ['0050_session_research_membership'] })
    expect(await client.session.findUnique({ where: { id: 's' } })).toEqual(before)
    expect(await client.$queryRawUnsafe('PRAGMA foreign_key_check')).toEqual([])
    await expect(migrateApplicationDatabase(client)).resolves.toMatchObject({ applied: [] })
  } finally {
    await client.$disconnect()
    await rm(root, { recursive: true, force: true })
  }
})

it.each(['valid', 'changed checksum', 'missing history'] as const)(
  'upgrades only the exact pre-translation Test fork ledger: %s',
  async (history) => {
    const root = await mkdtemp(join(tmpdir(), 'research-membership-upstream-'))
    const client = createProjectDbClient(root)
    try {
      await migrateApplicationDatabase(client)
      await client.project.create({ data: { id: 'p', name: 'Existing research' } })
      await client.session.create({
        data: {
          id: 's',
          number: 1,
          projectId: 'p',
          title: 'Existing discussion',
          status: 'idle',
          presentedStatus: 'idle',
          archivedAtMs: 3n,
          revision: 5n,
          createdAtMs: 1n,
          updatedAtMs: 2n,
          researchMembershipJson: '{"researchId":"saved-research"}',
          importedResearchId: 'saved-research'
        }
      })
      const before = await client.session.findUnique({ where: { id: 's' } })
      // Recreate the released fork's schema and ledger, without translation tables.
      for (const table of ['PdfTranslationBlock', 'PdfTranslation', 'PdfTranslationUsage'])
        await client.$executeRawUnsafe(`DROP TABLE "${table}"`)
      await client.$executeRawUnsafe(
        "DELETE FROM _open_science_migrations WHERE id = '0050_literature_translation'"
      )
      if (history === 'changed checksum')
        await client.$executeRawUnsafe(
          "UPDATE _open_science_migrations SET checksum = ? WHERE id = '0050_session_research_membership'",
          '0'.repeat(64)
        )
      if (history === 'missing history')
        await client.$executeRawUnsafe(
          "DELETE FROM _open_science_migrations WHERE id = '0049_pascalcase_table_names'"
        )
      const backups: string[] = []
      const upgrade = migrateApplicationDatabase(client, {
        databasePath: join(root, 'open-science.db'),
        onBackupReady: (backup) => {
          backups.push(backup.path)
        }
      })
      if (history === 'valid') {
        await expect(upgrade).resolves.toMatchObject({
          applied: ['0050_literature_translation'],
          from: '0050_session_research_membership',
          to: '0050_session_research_membership'
        })
        expect(backups).toHaveLength(1)
        expect(await client.$queryRawUnsafe('PRAGMA foreign_key_check')).toEqual([])
        await expect(migrateApplicationDatabase(client)).resolves.toMatchObject({ applied: [] })
      } else {
        await expect(upgrade).rejects.toMatchObject({ code: 'database_history_invalid' })
        expect(backups).toEqual([])
        expect(
          await client.$queryRawUnsafe(
            "SELECT name FROM sqlite_schema WHERE type = 'table' AND name = 'PdfTranslation'"
          )
        ).toEqual([])
      }
      expect(await client.session.findUnique({ where: { id: 's' } })).toEqual(before)
    } finally {
      await client.$disconnect()
      await rm(root, { recursive: true, force: true })
    }
  }
)
