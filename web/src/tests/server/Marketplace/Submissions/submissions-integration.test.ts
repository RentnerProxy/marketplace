import { afterAll, beforeAll, expect, test, vi } from 'bun:test'
import { eq } from 'drizzle-orm'
import { PGlite } from '@electric-sql/pglite'
import { drizzle } from 'drizzle-orm/pglite'
import { migrate } from 'drizzle-orm/pglite/migrator'
import * as schema from '@/db/schema.ts'
import { fixtureClaim, fixtureSubmission } from './submission.fixture.ts'

const client = new PGlite()
const db = drizzle(client, { schema })
vi.mock('@/db', () => ({ db }))
let onBarrierExit = () => {}
const barrier = vi.fn(async (work: () => Promise<void>) => {
    await work()
    onBarrierExit()
})
vi.mock('@/server/Storage/storage-mutation-barrier.service.ts', () => ({
    RestoreInProgressError: class extends Error {},
    withSharedStorageMutationBarrier: barrier,
}))

const { exerciseSubmissionLifecycle } =
    await import('./submission-lifecycle.fixture.ts')

beforeAll(async () => {
    await migrate(db, { migrationsFolder: './web/drizzle' })
})

afterAll(async () => {
    await client.close()
})

test(
    'recovers candidate validation and authorizes exact publication on a migrated PostgreSQL schema',
    exerciseSubmissionLifecycle,
)

test('rechecks restore quiescence inside the shared barrier before leasing work', async () => {
    const { runCandidateValidationWorker } =
        await import('@/server/Marketplace/Submissions/validation.worker.ts')
    const claim = fixtureClaim()
    const submission = {
        ...fixtureSubmission(claim),
        status: 'submitted' as const,
        dispatchRequestedAt: null,
    }
    await db.insert(schema.marketplaceRepositoryClaims).values(claim)
    await db.insert(schema.marketplaceSubmissions).values(submission)

    const controller = new AbortController()
    onBarrierExit = () => controller.abort()
    const restore = vi.fn(async () => true).mockResolvedValueOnce(false)
    const previousToken = process.env.MARKETPLACE_CANDIDATE_GITHUB_TOKEN
    process.env.MARKETPLACE_CANDIDATE_GITHUB_TOKEN = 'fixture-actions-token'
    try {
        await runCandidateValidationWorker(controller.signal, restore)
        expect(barrier).toHaveBeenCalledTimes(1)
        expect(restore).toHaveBeenCalledTimes(2)
        const [row] = await db
            .select()
            .from(schema.marketplaceSubmissions)
            .where(eq(schema.marketplaceSubmissions.id, submission.id))
        expect(row).toMatchObject({
            status: 'submitted',
            nextCheckAt: submission.nextCheckAt,
            dispatchRequestedAt: null,
        })
    } finally {
        if (previousToken === undefined)
            delete process.env.MARKETPLACE_CANDIDATE_GITHUB_TOKEN
        else process.env.MARKETPLACE_CANDIDATE_GITHUB_TOKEN = previousToken
        await db
            .delete(schema.marketplaceSubmissions)
            .where(eq(schema.marketplaceSubmissions.id, submission.id))
        await db
            .delete(schema.marketplaceRepositoryClaims)
            .where(eq(schema.marketplaceRepositoryClaims.id, claim.id))
    }
})
