import { and, desc, eq } from 'drizzle-orm'
import { db } from '@/db'
import {
    app_store_entries,
    marketplaceSubmissions,
    user_profiles,
    users,
} from '@/db/schema.ts'
import { APP_STORE_CONFIG } from '@/config/app-store.config.ts'
import type {
    AppDetail,
    CatalogApp,
    StoreAppInput,
} from '@/features/AppStore/Types/app-store.types.ts'
import { buildProfileAppsService } from '@/server/Social/profileApps.service.ts'
import {
    getAppStarCountsService,
    getStarredAppIdsService,
} from '@/server/Social/stars.service.ts'
import { visibleAccount } from '@/server/Social/visibility.ts'
import { readStoreListingService } from './entry.service.ts'

/** Public detail of a published app, from its latest published version. */
export async function getAppDetailService(
    input: StoreAppInput,
    viewerId: string | null,
): Promise<AppDetail | null> {
    const release = (
        await db
            .select({
                submitterId: marketplaceSubmissions.submitterId,
                version: marketplaceSubmissions.version,
                request: marketplaceSubmissions.request,
                publication: marketplaceSubmissions.publication,
                createdAt: marketplaceSubmissions.createdAt,
            })
            .from(marketplaceSubmissions)
            .where(
                and(
                    eq(marketplaceSubmissions.appId, input.appId),
                    eq(marketplaceSubmissions.status, 'published'),
                ),
            )
            .orderBy(desc(marketplaceSubmissions.createdAt))
            .limit(1)
    ).at(0)

    if (!release) {
        return null
    }

    const [listing, publisherRows, starCounts, starredIds] = await Promise.all([
        readStoreListingService(input.appId),
        db
            .select({
                id: users.id,
                username: users.username,
                profileImageUpdatedAt: user_profiles.profileImageUpdatedAt,
            })
            .from(users)
            .leftJoin(user_profiles, eq(user_profiles.userId, users.id))
            .where(and(eq(users.id, release.submitterId), visibleAccount))
            .limit(1),
        getAppStarCountsService([input.appId]),
        getStarredAppIdsService(viewerId, [input.appId]),
    ])
    const publisher = publisherRows.at(0)

    return {
        appId: input.appId,
        name: release.request.display.name,
        summary: release.request.display.summary,
        license: release.request.display.license,
        version: release.version,
        publishedAt:
            release.publication?.publishedAt ?? release.createdAt.toISOString(),
        description: listing.description,
        logoSrc: listing.logoSrc,
        screenshots: listing.screenshots,
        starCount: starCounts.get(input.appId) ?? 0,
        isStarred: starredIds.has(input.appId),
        canEdit: viewerId !== null && viewerId === release.submitterId,
        publisher: publisher
            ? {
                  id: publisher.id,
                  username: publisher.username,
                  profileImageVersion:
                      publisher.profileImageUpdatedAt?.getTime() ?? null,
              }
            : null,
    }
}

/** All published apps (latest version each), newest first. */
export async function listPublishedAppsService(
    viewerId: string | null,
): Promise<Array<CatalogApp>> {
    const rows = await db
        .selectDistinctOn([marketplaceSubmissions.appId], {
            appId: marketplaceSubmissions.appId,
            version: marketplaceSubmissions.version,
            request: marketplaceSubmissions.request,
            publication: marketplaceSubmissions.publication,
            createdAt: marketplaceSubmissions.createdAt,
            logoFileId: app_store_entries.logoFileId,
            publisher: users.username,
        })
        .from(marketplaceSubmissions)
        .leftJoin(
            app_store_entries,
            eq(app_store_entries.appId, marketplaceSubmissions.appId),
        )
        .leftJoin(
            users,
            and(
                eq(users.id, marketplaceSubmissions.submitterId),
                visibleAccount,
            ),
        )
        .where(eq(marketplaceSubmissions.status, 'published'))
        .orderBy(
            marketplaceSubmissions.appId,
            desc(marketplaceSubmissions.createdAt),
        )
        .limit(APP_STORE_CONFIG.catalogLimit)
    const publishers = new Map(rows.map((row) => [row.appId, row.publisher]))
    const apps = await buildProfileAppsService(rows, viewerId)

    return apps.map((app) =>
        Object.assign(app, { publisher: publishers.get(app.appId) ?? null }),
    )
}
