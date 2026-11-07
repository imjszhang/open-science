// Immutable migration: these columns are a disposable projection of Session JSON.
// Fork-owned ids use five digits starting at 10000 so they sort after upstream's
// four-digit ids (0052, 0053, …) and do not take the next shared number.
const sessionResearchMembershipMigration = {
  id: '10052_session_research_membership',
  statements: [
    `ALTER TABLE "Session" ADD COLUMN "researchMembershipJson" TEXT`,
    `ALTER TABLE "Session" ADD COLUMN "importedResearchId" TEXT`
  ] as const,
  operations: [] as const,
  verifiers: [
    { kind: 'column-exists', version: 1, table: 'Session', column: 'researchMembershipJson' },
    { kind: 'column-exists', version: 1, table: 'Session', column: 'importedResearchId' }
  ] as const
}
export { sessionResearchMembershipMigration }
