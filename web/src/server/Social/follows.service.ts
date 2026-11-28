import { and, eq } from 'drizzle-orm'
import { db } from '@/db'
import { notifications, user_follows } from '@/db/schema.ts'
import type {
    FollowResult,
    FollowUserInput,
} from '@/features/Social/Types/social.types.ts'
import { logError } from '@/server/Logging/logger.ts'
import { createNotificationsService } from '@/server/Notifications/update.service.ts'
import {
    countVisibleFollowersService,
    getFollowTargetService,
} from './profiles.service.ts'

const FOLLOW_NOTIFICATION_TYPE = 'social-follow'

/** One notification per follower: toggling follow on and off must not spam. */
async function notifyNewFollower(
    targetId: string,
    follower: { id: string; username: string },
) {
    try {
        const existing = await db
            .select({ id: notifications.id })
            .from(notifications)
            .where(
                and(
                    eq(notifications.userId, targetId),
                    eq(notifications.type, FOLLOW_NOTIFICATION_TYPE),
                    eq(notifications.referenceId, follower.id),
                ),
            )
            .limit(1)

        if (existing.length > 0) {
            return
        }

        await createNotificationsService([
            {
                userId: targetId,
                title: 'Neuer Follower',
                message: `${follower.username} folgt dir jetzt.`,
                type: FOLLOW_NOTIFICATION_TYPE,
                referenceId: follower.id,
            },
        ])
    } catch (error) {
        logError('social.follow_notification_failed', error, { targetId })
    }
}

export async function followUserService(
    input: FollowUserInput,
    follower: { id: string; username: string },
): Promise<FollowResult> {
    const target = await getFollowTargetService(input.userId, follower.id)

    if (!target) {
        return {
            success: false,
            error: 'Diesem Konto kann nicht gefolgt werden.',
        }
    }

    const inserted = await db
        .insert(user_follows)
        .values({ followerId: follower.id, followingId: target.id })
        .onConflictDoNothing()
        .returning({ followingId: user_follows.followingId })

    if (inserted.length > 0) {
        await notifyNewFollower(target.id, follower)
    }

    return {
        success: true,
        isFollowing: true,
        followerCount: await countVisibleFollowersService(target.id),
    }
}

export async function unfollowUserService(
    input: FollowUserInput,
    followerId: string,
): Promise<FollowResult> {
    await db
        .delete(user_follows)
        .where(
            and(
                eq(user_follows.followerId, followerId),
                eq(user_follows.followingId, input.userId),
            ),
        )

    return {
        success: true,
        isFollowing: false,
        followerCount: await countVisibleFollowersService(input.userId),
    }
}
