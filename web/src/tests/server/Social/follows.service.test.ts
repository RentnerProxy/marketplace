import { beforeEach, describe, expect, it, vi } from 'bun:test'
import { createQueuedDatabase } from './social-db.test.helpers.ts'

const database = createQueuedDatabase()
const follower = { id: '019f72d1-dc60-7040-bdac-9e201573f001', username: 'ada' }
const targetId = '019f72d1-dc60-7040-bdac-9e201573f002'
const mocks = {
    target: vi.fn(
        async (
            _targetId: string,
            _followerId: string,
        ): Promise<{ id: string; username: string } | null> => ({
            id: targetId,
            username: 'kevin',
        }),
    ),
    count: vi.fn(async (_userId: string) => 7),
    notify: vi.fn(async (_input: unknown) => {}),
    logError: vi.fn(),
}

vi.mock('@/db', () => ({ db: database.db }))
vi.mock('@/server/Social/profiles.service.ts', () => ({
    getFollowTargetService: mocks.target,
    countVisibleFollowersService: mocks.count,
}))
vi.mock('@/server/Notifications/update.service.ts', () => ({
    createNotificationsService: mocks.notify,
}))
vi.mock('@/server/Logging/logger.ts', () => ({ logError: mocks.logError }))

const { followUserService, unfollowUserService } =
    await import('@/server/Social/follows.service.ts')

beforeEach(() => {
    database.reset()
    vi.clearAllMocks()
    mocks.target.mockResolvedValue({ id: targetId, username: 'kevin' })
    mocks.notify.mockResolvedValue(undefined)
})

describe('follow service', () => {
    it('rejects own, unknown or hidden accounts', async () => {
        mocks.target.mockResolvedValue(null)
        await expect(
            followUserService({ userId: targetId }, follower),
        ).resolves.toEqual({
            success: false,
            error: 'Diesem Konto kann nicht gefolgt werden.',
        })
        expect(database.calls).toHaveLength(0)
    })

    it('follows and notifies the followed account once', async () => {
        database.queue([{ followingId: targetId }], [])
        await expect(
            followUserService({ userId: targetId }, follower),
        ).resolves.toEqual({
            success: true,
            isFollowing: true,
            followerCount: 7,
        })
        expect(mocks.notify).toHaveBeenCalledWith([
            {
                userId: targetId,
                title: 'Neuer Follower',
                message: 'ada folgt dir jetzt.',
                type: 'social-follow',
                referenceId: follower.id,
            },
        ])
    })

    it('does not notify again for an existing follow or earlier notification', async () => {
        database.queue([])
        await followUserService({ userId: targetId }, follower)
        database.queue([{ followingId: targetId }], [{ id: 'existing' }])
        await followUserService({ userId: targetId }, follower)
        expect(mocks.notify).not.toHaveBeenCalled()
    })

    it('keeps the follow when the notification fails', async () => {
        const error = new Error('realtime offline')
        mocks.notify.mockRejectedValue(error)
        database.queue([{ followingId: targetId }], [])
        await expect(
            followUserService({ userId: targetId }, follower),
        ).resolves.toMatchObject({ success: true })
        expect(mocks.logError).toHaveBeenCalledWith(
            'social.follow_notification_failed',
            error,
            { targetId },
        )
    })

    it('unfollows idempotently and reports the new follower count', async () => {
        database.queue(undefined)
        await expect(
            unfollowUserService({ userId: targetId }, follower.id),
        ).resolves.toEqual({
            success: true,
            isFollowing: false,
            followerCount: 7,
        })
        expect(database.methods()).toContain('delete')
    })
})
