import {
    and,
    asc,
    count,
    countDistinct,
    desc,
    eq,
    ilike,
    inArray,
    sql,
} from 'drizzle-orm'
import { db } from '@/db'
import {
    marketplaceSubmissions,
    user_follows,
    user_profiles,
    user_settings,
    users,
} from '@/db/schema.ts'
import { SOCIAL_CONFIG } from '@/config/social.config.ts'
import { countReceivedStarsService } from './stars.service.ts'
import { visibleAccount } from './visibility.ts'
import type {
    GetProfileFollowsInput,
    GetPublicProfileInput,
    ProfileFollowsPage,
    ProfileSummary,
    PublicProfile,
    SearchProfilesInput,
} from '@/features/Social/Types/social.types.ts'

const summaryColumns = {
    id: users.id,
    username: users.username,
    accountType: users.accountType,
    bio: user_profiles.bio,
    profileImageUpdatedAt: user_profiles.profileImageUpdatedAt,
}

type SummaryRow = {
    id: string
    username: string
    accountType: string
    bio: string | null
    profileImageUpdatedAt: Date | null
}

async function getFollowedIds(
    viewerId: string | null,
    profileIds: Array<string>,
): Promise<Set<string>> {
    if (!viewerId || profileIds.length === 0) {
        return new Set()
    }

    const rows = await db
        .select({ followingId: user_follows.followingId })
        .from(user_follows)
        .where(
            and(
                eq(user_follows.followerId, viewerId),
                inArray(user_follows.followingId, profileIds),
            ),
        )

    return new Set(rows.map((row) => row.followingId))
}

function toSummary(
    row: SummaryRow,
    viewerId: string | null,
    followedIds: Set<string>,
): ProfileSummary {
    return {
        id: row.id,
        username: row.username,
        bio: row.bio,
        isTeam: row.accountType === 'staff',
        profileImageVersion: row.profileImageUpdatedAt?.getTime() ?? null,
        isFollowing: followedIds.has(row.id),
        isSelf: row.id === viewerId,
    }
}

async function toSummaries(
    rows: Array<SummaryRow>,
    viewerId: string | null,
): Promise<Array<ProfileSummary>> {
    const followedIds = await getFollowedIds(
        viewerId,
        rows.map((row) => row.id),
    )

    return rows.map((row) => toSummary(row, viewerId, followedIds))
}

export async function countVisibleFollowersService(userId: string) {
    const rows = await db
        .select({ value: count() })
        .from(user_follows)
        .innerJoin(users, eq(users.id, user_follows.followerId))
        .where(and(eq(user_follows.followingId, userId), visibleAccount))

    return rows.at(0)?.value ?? 0
}

async function countVisibleFollowing(userId: string) {
    const rows = await db
        .select({ value: count() })
        .from(user_follows)
        .innerJoin(users, eq(users.id, user_follows.followingId))
        .where(and(eq(user_follows.followerId, userId), visibleAccount))

    return rows.at(0)?.value ?? 0
}

/** Distinct apps with a published version submitted by the account. */
async function countPublishedApps(userId: string) {
    const rows = await db
        .select({ value: countDistinct(marketplaceSubmissions.appId) })
        .from(marketplaceSubmissions)
        .where(
            and(
                eq(marketplaceSubmissions.submitterId, userId),
                eq(marketplaceSubmissions.status, 'published'),
            ),
        )

    return rows.at(0)?.value ?? 0
}

export async function getPublicProfileService(
    input: GetPublicProfileInput,
    viewerId: string | null,
): Promise<PublicProfile | null> {
    const row = (
        await db
            .select({
                ...summaryColumns,
                createdAt: users.createdAt,
                bannerUpdatedAt: user_settings.customBackgroundUpdatedAt,
            })
            .from(users)
            .leftJoin(user_profiles, eq(user_profiles.userId, users.id))
            .leftJoin(user_settings, eq(user_settings.userId, users.id))
            .where(and(eq(users.username, input.username), visibleAccount))
            .limit(1)
    ).at(0)

    if (!row) {
        return null
    }

    const [followedIds, followerCount, followingCount, appCount, starCount] =
        await Promise.all([
            getFollowedIds(viewerId, [row.id]),
            countVisibleFollowersService(row.id),
            countVisibleFollowing(row.id),
            countPublishedApps(row.id),
            countReceivedStarsService(row.id),
        ])

    return {
        ...toSummary(row, viewerId, followedIds),
        bannerVersion: row.bannerUpdatedAt?.toISOString() ?? null,
        followerCount,
        followingCount,
        appCount,
        starCount,
        joinedAt: row.createdAt.toISOString(),
    }
}

/** Treat user input literally inside ILIKE patterns. */
export function escapeLikePattern(value: string) {
    return value.replace(/[\\%_]/gu, (character) => `\\${character}`)
}

export async function searchProfilesService(
    input: SearchProfilesInput,
    viewerId: string | null,
): Promise<Array<ProfileSummary>> {
    const rows = await db
        .select(summaryColumns)
        .from(users)
        .leftJoin(user_profiles, eq(user_profiles.userId, users.id))
        .where(
            and(
                visibleAccount,
                ilike(users.username, `%${escapeLikePattern(input.query)}%`),
            ),
        )
        .orderBy(sql`length(${users.username})`, asc(users.username))
        .limit(SOCIAL_CONFIG.searchResultLimit)

    return toSummaries(rows, viewerId)
}

export async function getProfileFollowsService(
    input: GetProfileFollowsInput,
    viewerId: string | null,
): Promise<ProfileFollowsPage | null> {
    const owner = (
        await db
            .select({ id: users.id })
            .from(users)
            .where(and(eq(users.username, input.username), visibleAccount))
            .limit(1)
    ).at(0)

    if (!owner) {
        return null
    }

    const isFollowerList = input.list === 'followers'
    const listedColumn = isFollowerList
        ? user_follows.followerId
        : user_follows.followingId
    const ownerColumn = isFollowerList
        ? user_follows.followingId
        : user_follows.followerId
    const pageSize = SOCIAL_CONFIG.followListPageSize
    const rows = await db
        .select(summaryColumns)
        .from(user_follows)
        .innerJoin(users, eq(users.id, listedColumn))
        .leftJoin(user_profiles, eq(user_profiles.userId, users.id))
        .where(and(eq(ownerColumn, owner.id), visibleAccount))
        .orderBy(desc(user_follows.createdAt), asc(users.id))
        .limit(pageSize + 1)
        .offset(input.offset)

    return {
        profiles: await toSummaries(rows.slice(0, pageSize), viewerId),
        nextOffset: rows.length > pageSize ? input.offset + pageSize : null,
    }
}

/** Visible account that may be followed, or null for unknown, hidden or own ids. */
export async function getFollowTargetService(
    targetId: string,
    followerId: string,
) {
    if (targetId === followerId) {
        return null
    }

    const target = (
        await db
            .select({ id: users.id, username: users.username })
            .from(users)
            .where(and(eq(users.id, targetId), visibleAccount))
            .limit(1)
    ).at(0)

    return target ?? null
}
