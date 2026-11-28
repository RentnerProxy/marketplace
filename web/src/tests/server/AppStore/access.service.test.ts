import { beforeEach, describe, expect, it, vi } from 'bun:test'
import { PERMISSIONS } from '@/config/permissions.config.ts'
import { createQueuedDatabase } from '../Social/social-db.test.helpers.ts'

const database = createQueuedDatabase()
const sessionUser = { id: '019f72d1-dc60-7040-bdac-9e201573f001' }
let permissionKeys: Array<string> = []

vi.mock('@/db', () => ({ db: database.db }))
vi.mock('@/server/Auth/authorization.service.ts', () => ({
    requireAuthenticatedFeatureAccessService: async () => ({
        sessionUser,
        permissionKeys,
    }),
}))

const {
    isPublishedAppService,
    readLatestSubmissionService,
    resolveStoreEditorService,
} = await import('@/server/AppStore/access.service.ts')

const submission = {
    submitterId: sessionUser.id,
    status: 'published',
    request: { display: { name: 'Wetter' } },
}

beforeEach(() => {
    database.reset()
    permissionKeys = []
})

describe('store editor access', () => {
    it('lets the submitter of an app edit it', async () => {
        database.queue([submission])
        await expect(
            resolveStoreEditorService('rentner.weather'),
        ).resolves.toEqual({
            actorId: sessionUser.id,
            latestOwnOrAnySubmission: submission as never,
        })
        expect(
            database.calls.filter((c) => c.method === 'select'),
        ).toHaveLength(1)
    })

    it('denies accounts without a submission and without review permission', async () => {
        database.queue([])
        await expect(
            resolveStoreEditorService('rentner.weather'),
        ).resolves.toBe(null)
        expect(
            database.calls.filter((c) => c.method === 'select'),
        ).toHaveLength(1)
    })

    it('does not let other permissions replace ownership', async () => {
        permissionKeys = [PERMISSIONS.ADMIN_USER_MANAGEMENT]
        database.queue([])
        await expect(
            resolveStoreEditorService('rentner.weather'),
        ).resolves.toBe(null)
    })

    it('lets marketplace reviewers edit any app', async () => {
        permissionKeys = [PERMISSIONS.ADMIN_MARKETPLACE_REVIEW]
        const foreign = { ...submission, submitterId: 'someone-else' }
        database.queue([], [foreign])
        await expect(
            resolveStoreEditorService('rentner.weather'),
        ).resolves.toEqual({
            actorId: sessionUser.id,
            latestOwnOrAnySubmission: foreign as never,
        })
    })

    it('denies reviewers for unknown app ids', async () => {
        permissionKeys = [PERMISSIONS.ADMIN_MARKETPLACE_REVIEW]
        database.queue([], [])
        await expect(resolveStoreEditorService('rentner.ghost')).resolves.toBe(
            null,
        )
    })

    it('reads the latest submission and the published state', async () => {
        database.queue([submission], [])
        await expect(
            readLatestSubmissionService('rentner.weather', null),
        ).resolves.toEqual(submission as never)
        await expect(
            readLatestSubmissionService('rentner.weather', sessionUser.id),
        ).resolves.toBeNull()

        database.queue([{ appId: 'rentner.weather' }], [])
        await expect(isPublishedAppService('rentner.weather')).resolves.toBe(
            true,
        )
        await expect(isPublishedAppService('rentner.weather')).resolves.toBe(
            false,
        )
    })
})
