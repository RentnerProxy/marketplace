import { beforeEach, describe, expect, it, vi } from 'bun:test'
import { createQueuedDatabase } from './social-db.test.helpers.ts'

const database = createQueuedDatabase()
vi.mock('@/db', () => ({ db: database.db }))

const {
    countReceivedStarsService,
    getAppStarCountsService,
    getStarredAppIdsService,
    starAppService,
    unstarAppService,
} = await import('@/server/Social/stars.service.ts')

const userId = '019f72d1-dc60-7040-bdac-9e201573f001'
const appId = 'rentner.weather-widget'

beforeEach(() => {
    database.reset()
})

describe('star counts', () => {
    it('sums stars over the published apps of an account', async () => {
        database.queue([{ value: 9 }])
        await expect(countReceivedStarsService(userId)).resolves.toBe(9)
        expect(database.methods()).toContain('selectDistinct')
        expect(database.methods()).toContain('innerJoin')
    })

    it('returns zero without any star rows', async () => {
        database.queue([])
        await expect(countReceivedStarsService(userId)).resolves.toBe(0)
    })

    it('groups star counts per app and skips empty lookups', async () => {
        await expect(getAppStarCountsService([])).resolves.toEqual(new Map())
        expect(database.calls).toHaveLength(0)

        database.queue([{ appId, value: 4 }])
        const counts = await getAppStarCountsService([appId, 'rentner.other'])
        expect(counts.get(appId)).toBe(4)
        expect(counts.get('rentner.other')).toBeUndefined()
        expect(database.methods()).toContain('groupBy')
    })

    it('marks starred apps only for a signed-in viewer', async () => {
        await expect(getStarredAppIdsService(null, [appId])).resolves.toEqual(
            new Set(),
        )
        await expect(getStarredAppIdsService(userId, [])).resolves.toEqual(
            new Set(),
        )
        expect(database.calls).toHaveLength(0)

        database.queue([{ appId }])
        await expect(getStarredAppIdsService(userId, [appId])).resolves.toEqual(
            new Set([appId]),
        )
    })
})

describe('starring apps', () => {
    it('refuses apps without a published version', async () => {
        database.queue([])
        await expect(starAppService({ appId }, userId)).resolves.toEqual({
            success: false,
            error: 'Diese App kann nicht markiert werden.',
        })
        expect(database.methods()).not.toContain('insert')
    })

    it('stores one star per account and returns the new count', async () => {
        database.queue([{ appId }], [], [{ appId, value: 3 }])
        await expect(starAppService({ appId }, userId)).resolves.toEqual({
            success: true,
            isStarred: true,
            starCount: 3,
        })
        expect(database.methods()).toContain('onConflictDoNothing')
    })

    it('removes a star and returns the remaining count', async () => {
        database.queue([], [])
        await expect(unstarAppService({ appId }, userId)).resolves.toEqual({
            success: true,
            isStarred: false,
            starCount: 0,
        })
        expect(database.methods()).toContain('delete')
    })
})
