import { beforeEach, describe, expect, it, vi } from 'bun:test'
import { createQueuedDatabase } from '../Social/social-db.test.helpers.ts'

const database = createQueuedDatabase()
const appId = 'rentner.weather-widget'
const submitterId = '019f72d1-dc60-7040-bdac-9e201573f001'
const otherViewerId = '019f72d1-dc60-7040-bdac-9e201573f002'
const shotId = '019f72d1-dc60-7040-bdac-9e201573f0a1'

const mocks = {
    listing: vi.fn(async (_appId: string) => ({
        description: 'Lange Beschreibung' as string | null,
        logoSrc: `/images/apps/${appId}/logo.webp` as string | null,
        screenshots: [
            { id: shotId, src: `/images/apps/${appId}/${shotId}.webp` },
        ],
    })),
    starCounts: vi.fn(async (_ids: Array<string>) => new Map([[appId, 7]])),
    starredIds: vi.fn(
        async (_viewerId: string | null, _ids: Array<string>) =>
            new Set<string>([appId]),
    ),
    buildApps: vi.fn(
        async (_rows: Array<unknown>, _viewerId: string | null) => [{ appId }],
    ),
}

vi.mock('@/db', () => ({ db: database.db }))
vi.mock('@/server/AppStore/entry.service.ts', () => ({
    readStoreListingService: mocks.listing,
}))
vi.mock('@/server/Social/stars.service.ts', () => ({
    getAppStarCountsService: mocks.starCounts,
    getStarredAppIdsService: mocks.starredIds,
}))
vi.mock('@/server/Social/profileApps.service.ts', () => ({
    buildProfileAppsService: mocks.buildApps,
}))

const { getAppDetailService, listPublishedAppsService } =
    await import('@/server/AppStore/catalog.service.ts')

const release = {
    submitterId,
    version: '1.2.0',
    request: {
        display: {
            name: 'Wetter',
            summary: 'Zeigt das Wetter.',
            license: 'MIT',
        },
    },
    publication: { publishedAt: '2026-10-02T00:00:00.000Z' },
    createdAt: new Date('2026-10-01T00:00:00.000Z'),
}

beforeEach(() => {
    database.reset()
    vi.clearAllMocks()
})

describe('app detail', () => {
    it('returns null without a published version', async () => {
        database.queue([])
        await expect(
            getAppDetailService({ appId }, submitterId),
        ).resolves.toBeNull()
        expect(mocks.listing).not.toHaveBeenCalled()
    })

    it('combines the release, listing, stars and visible publisher', async () => {
        database.queue(
            [release],
            [
                {
                    id: submitterId,
                    username: 'kevin',
                    profileImageUpdatedAt: new Date(1234),
                },
            ],
        )
        await expect(
            getAppDetailService({ appId }, otherViewerId),
        ).resolves.toEqual({
            appId,
            name: 'Wetter',
            summary: 'Zeigt das Wetter.',
            license: 'MIT',
            version: '1.2.0',
            publishedAt: '2026-10-02T00:00:00.000Z',
            description: 'Lange Beschreibung' as string | null,
            logoSrc: `/images/apps/${appId}/logo.webp`,
            screenshots: [
                { id: shotId, src: `/images/apps/${appId}/${shotId}.webp` },
            ],
            starCount: 7,
            isStarred: true,
            canEdit: false,
            publisher: {
                id: submitterId,
                username: 'kevin',
                profileImageVersion: 1234,
            },
        })
        expect(mocks.listing).toHaveBeenCalledWith(appId)
        expect(mocks.starCounts).toHaveBeenCalledWith([appId])
        expect(mocks.starredIds).toHaveBeenCalledWith(otherViewerId, [appId])
    })

    it('allows editing only for the submitter', async () => {
        database.queue([release], [])
        const own = await getAppDetailService({ appId }, submitterId)
        expect(own?.canEdit).toBe(true)

        database.queue([release], [])
        const anonymous = await getAppDetailService({ appId }, null)
        expect(anonymous?.canEdit).toBe(false)
    })

    it('hides the publisher when the account is not visible', async () => {
        database.queue([release], [])
        const detail = await getAppDetailService({ appId }, null)
        expect(detail?.publisher).toBeNull()
    })

    it('falls back to zero stars and the upload date', async () => {
        mocks.starCounts.mockResolvedValueOnce(new Map())
        mocks.starredIds.mockResolvedValueOnce(new Set())
        mocks.listing.mockResolvedValueOnce({
            description: null,
            logoSrc: null,
            screenshots: [],
        })
        database.queue(
            [{ ...release, publication: null }],
            [
                {
                    id: submitterId,
                    username: 'kevin',
                    profileImageUpdatedAt: null,
                },
            ],
        )
        await expect(
            getAppDetailService({ appId }, null),
        ).resolves.toMatchObject({
            publishedAt: '2026-10-01T00:00:00.000Z',
            description: null,
            logoSrc: null,
            screenshots: [],
            starCount: 0,
            isStarred: false,
            publisher: { profileImageVersion: null },
        })
    })
})

describe('published apps', () => {
    it('lists the latest published version of each app for the viewer', async () => {
        const rows = [{ appId, version: '1.2.0' }]
        database.queue(rows)
        await expect(listPublishedAppsService(submitterId)).resolves.toEqual([
            { appId } as never,
        ])
        expect(mocks.buildApps).toHaveBeenCalledWith(rows, submitterId)
        expect(database.methods()).toContain('selectDistinctOn')
        expect(database.methods()).toContain('leftJoin')
        expect(
            database.calls.find((call) => call.method === 'limit')?.args,
        ).toEqual([60])
    })
})
