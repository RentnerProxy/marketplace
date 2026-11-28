import { beforeEach, describe, expect, it, vi } from 'bun:test'
import { SOCIAL_CONFIG } from '@/config/social.config.ts'
import { createQueuedDatabase } from './social-db.test.helpers.ts'

const database = createQueuedDatabase()
vi.mock('@/db', () => ({ db: database.db }))

const {
    escapeLikePattern,
    getFollowTargetService,
    getProfileFollowsService,
    getPublicProfileService,
    searchProfilesService,
} = await import('@/server/Social/profiles.service.ts')

const viewerId = '019f72d1-dc60-7040-bdac-9e201573f001'
const ownerId = '019f72d1-dc60-7040-bdac-9e201573f002'
const imageDate = new Date('2026-11-01T10:00:00.000Z')

function summaryRow(id: string, username: string, accountType = 'public') {
    return {
        id,
        username,
        accountType,
        bio: `${username} bio`,
        profileImageUpdatedAt: imageDate,
    }
}

beforeEach(() => {
    database.reset()
})

describe('public profiles', () => {
    it('hides unknown, deleted or inactive accounts', async () => {
        database.queue([])
        await expect(
            getPublicProfileService({ username: 'ghost' }, null),
        ).resolves.toBeNull()
    })

    it('maps a team profile with counts and the viewer follow state', async () => {
        database.queue(
            [
                {
                    ...summaryRow(ownerId, 'kevin', 'staff'),
                    createdAt: new Date('2026-01-02T00:00:00.000Z'),
                    bannerUpdatedAt: new Date('2026-11-27T20:00:00.000Z'),
                },
            ],
            [{ followingId: ownerId }],
            [{ value: 5 }],
            [{ value: 3 }],
            [{ value: 2 }],
            [{ value: 7 }],
        )

        await expect(
            getPublicProfileService({ username: 'kevin' }, viewerId),
        ).resolves.toEqual({
            id: ownerId,
            username: 'kevin',
            bio: 'kevin bio',
            isTeam: true,
            profileImageVersion: imageDate.getTime(),
            isFollowing: true,
            isSelf: false,
            bannerVersion: '2026-11-27T20:00:00.000Z',
            followerCount: 5,
            followingCount: 3,
            appCount: 2,
            starCount: 7,
            joinedAt: '2026-01-02T00:00:00.000Z',
        })
    })

    it('marks the own profile for anonymous follow state without a follow lookup', async () => {
        database.queue(
            [
                {
                    ...summaryRow(ownerId, 'kevin'),
                    profileImageUpdatedAt: null,
                    createdAt: new Date('2026-01-02T00:00:00.000Z'),
                    bannerUpdatedAt: null,
                },
            ],
            [],
            [],
            [],
            [],
        )
        const profile = await getPublicProfileService(
            { username: 'kevin' },
            null,
        )
        expect(profile).toMatchObject({
            isFollowing: false,
            isSelf: false,
            bannerVersion: null,
            profileImageVersion: null,
            followerCount: 0,
            followingCount: 0,
            appCount: 0,
            starCount: 0,
        })
    })
})

describe('profile search and follow lists', () => {
    it('escapes LIKE wildcards in user input', () => {
        expect(escapeLikePattern('a%b_c\\d')).toBe('a\\%b\\_c\\\\d')
    })

    it('returns summaries with follow and self markers', async () => {
        database.queue(
            [summaryRow(viewerId, 'me'), summaryRow(ownerId, 'kevin')],
            [{ followingId: ownerId }],
        )
        const results = await searchProfilesService({ query: 'ke' }, viewerId)
        expect(
            results.map((result) => [result.username, result.isSelf]),
        ).toEqual([
            ['me', true],
            ['kevin', false],
        ])
        expect(results[1]?.isFollowing).toBe(true)
        expect(database.methods()).toContain('limit')
    })

    it('returns null for an unknown list owner', async () => {
        database.queue([])
        await expect(
            getProfileFollowsService(
                { username: 'ghost', list: 'followers', offset: 0 },
                null,
            ),
        ).resolves.toBeNull()
    })

    it('pages follower lists by one extra row', async () => {
        const pageSize = SOCIAL_CONFIG.followListPageSize
        const rows = Array.from({ length: pageSize + 1 }, (_, index) =>
            summaryRow(`id-${index}`, `user${index}`),
        )
        database.queue([{ id: ownerId }], rows)
        const page = await getProfileFollowsService(
            { username: 'kevin', list: 'following', offset: 0 },
            null,
        )
        expect(page?.profiles).toHaveLength(pageSize)
        expect(page?.nextOffset).toBe(pageSize)

        database.queue([{ id: ownerId }], rows.slice(0, 2))
        await expect(
            getProfileFollowsService(
                { username: 'kevin', list: 'followers', offset: 30 },
                null,
            ),
        ).resolves.toMatchObject({ nextOffset: null })
    })
})

describe('follow targets', () => {
    it('never resolves the follower itself', async () => {
        await expect(getFollowTargetService(viewerId, viewerId)).resolves.toBe(
            null,
        )
        expect(database.calls).toHaveLength(0)
    })

    it('resolves visible accounts only', async () => {
        database.queue([{ id: ownerId, username: 'kevin' }])
        await expect(
            getFollowTargetService(ownerId, viewerId),
        ).resolves.toEqual({ id: ownerId, username: 'kevin' })
        database.queue([])
        await expect(getFollowTargetService(ownerId, viewerId)).resolves.toBe(
            null,
        )
    })
})
