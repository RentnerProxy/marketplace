import { and, desc, eq } from 'drizzle-orm'
import { db } from '@/db'
import {
    app_store_entries,
    marketplaceSubmissions,
    users,
} from '@/db/schema.ts'
import { SOCIAL_CONFIG } from '@/config/social.config.ts'
import type {
    GetProfileAppsInput,
    ProfileApp,
} from '@/features/Social/Types/social.types.ts'
import type { SubmissionInput } from '@/lib/Marketplace/Types/submission.types.ts'
import { getStoreImageSrc } from '@/server/AppStore/images.service.ts'
import {
    getAppStarCountsService,
    getStarredAppIdsService,
} from './stars.service.ts'
import { visibleAccount } from './visibility.ts'

type PublishedAppRow = {
    appId: string
    version: string
    request: SubmissionInput
    publication: { publishedAt: string } | null
    createdAt: Date
    logoFileId: string | null
}

/** App cards with logo, stars and the viewer's star state, newest first. */
export async function buildProfileAppsService(
    rows: Array<PublishedAppRow>,
    viewerId: string | null,
): Promise<Array<ProfileApp>> {
    const appIds = rows.map((row) => row.appId)
    const [starCounts, starredIds] = await Promise.all([
        getAppStarCountsService(appIds),
        getStarredAppIdsService(viewerId, appIds),
    ])

    return rows
        .map((row) => ({
            appId: row.appId,
            name: row.request.display.name,
            summary: row.request.display.summary,
            license: row.request.display.license,
            version: row.version,
            publishedAt:
                row.publication?.publishedAt ?? row.createdAt.toISOString(),
            logoSrc: getStoreImageSrc(row.appId, row.logoFileId),
            starCount: starCounts.get(row.appId) ?? 0,
            isStarred: starredIds.has(row.appId),
        }))
        .toSorted((left, right) =>
            right.publishedAt.localeCompare(left.publishedAt),
        )
}

/** Latest published version per app of a visible account, newest first. */
export async function getProfileAppsService(
    input: GetProfileAppsInput,
    viewerId: string | null,
): Promise<Array<ProfileApp> | null> {
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

    const rows = await db
        .selectDistinctOn([marketplaceSubmissions.appId], {
            appId: marketplaceSubmissions.appId,
            version: marketplaceSubmissions.version,
            request: marketplaceSubmissions.request,
            publication: marketplaceSubmissions.publication,
            createdAt: marketplaceSubmissions.createdAt,
            logoFileId: app_store_entries.logoFileId,
        })
        .from(marketplaceSubmissions)
        .leftJoin(
            app_store_entries,
            eq(app_store_entries.appId, marketplaceSubmissions.appId),
        )
        .where(
            and(
                eq(marketplaceSubmissions.submitterId, owner.id),
                eq(marketplaceSubmissions.status, 'published'),
            ),
        )
        .orderBy(
            marketplaceSubmissions.appId,
            desc(marketplaceSubmissions.createdAt),
        )
        .limit(SOCIAL_CONFIG.profileAppLimit)

    return buildProfileAppsService(rows, viewerId)
}
