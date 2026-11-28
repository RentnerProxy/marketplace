import { and, count, eq, inArray } from 'drizzle-orm'
import { db } from '@/db'
import { app_stars, marketplaceSubmissions, users } from '@/db/schema.ts'
import type {
    StarAppInput,
    StarResult,
} from '@/features/Social/Types/social.types.ts'
import { visibleAccount } from './visibility.ts'

/** App ids with at least one published version submitted by the account. */
function publishedAppIdsOf(userId: string) {
    return db
        .selectDistinct({ appId: marketplaceSubmissions.appId })
        .from(marketplaceSubmissions)
        .where(
            and(
                eq(marketplaceSubmissions.submitterId, userId),
                eq(marketplaceSubmissions.status, 'published'),
            ),
        )
}

/** Stars from visible accounts on all published apps of the account. */
export async function countReceivedStarsService(userId: string) {
    const rows = await db
        .select({ value: count() })
        .from(app_stars)
        .innerJoin(users, eq(users.id, app_stars.userId))
        .where(
            and(
                inArray(app_stars.appId, publishedAppIdsOf(userId)),
                visibleAccount,
            ),
        )

    return rows.at(0)?.value ?? 0
}

/** Star count per app id, counting visible accounts only. */
export async function getAppStarCountsService(
    appIds: Array<string>,
): Promise<Map<string, number>> {
    if (appIds.length === 0) {
        return new Map()
    }

    const rows = await db
        .select({ appId: app_stars.appId, value: count() })
        .from(app_stars)
        .innerJoin(users, eq(users.id, app_stars.userId))
        .where(and(inArray(app_stars.appId, appIds), visibleAccount))
        .groupBy(app_stars.appId)

    return new Map(rows.map((row) => [row.appId, row.value]))
}

export async function getStarredAppIdsService(
    viewerId: string | null,
    appIds: Array<string>,
): Promise<Set<string>> {
    if (!viewerId || appIds.length === 0) {
        return new Set()
    }

    const rows = await db
        .select({ appId: app_stars.appId })
        .from(app_stars)
        .where(
            and(
                eq(app_stars.userId, viewerId),
                inArray(app_stars.appId, appIds),
            ),
        )

    return new Set(rows.map((row) => row.appId))
}

async function isPublishedApp(appId: string) {
    const rows = await db
        .select({ appId: marketplaceSubmissions.appId })
        .from(marketplaceSubmissions)
        .where(
            and(
                eq(marketplaceSubmissions.appId, appId),
                eq(marketplaceSubmissions.status, 'published'),
            ),
        )
        .limit(1)

    return rows.length > 0
}

async function countAppStars(appId: string) {
    return (await getAppStarCountsService([appId])).get(appId) ?? 0
}

/** Only published apps can receive stars; starring twice keeps one star. */
export async function starAppService(
    input: StarAppInput,
    userId: string,
): Promise<StarResult> {
    if (!(await isPublishedApp(input.appId))) {
        return {
            success: false,
            error: 'Diese App kann nicht markiert werden.',
        }
    }

    await db
        .insert(app_stars)
        .values({ userId, appId: input.appId })
        .onConflictDoNothing()

    return {
        success: true,
        isStarred: true,
        starCount: await countAppStars(input.appId),
    }
}

/** Removing a star also works for apps that are no longer published. */
export async function unstarAppService(
    input: StarAppInput,
    userId: string,
): Promise<StarResult> {
    await db
        .delete(app_stars)
        .where(
            and(eq(app_stars.userId, userId), eq(app_stars.appId, input.appId)),
        )

    return {
        success: true,
        isStarred: false,
        starCount: await countAppStars(input.appId),
    }
}
