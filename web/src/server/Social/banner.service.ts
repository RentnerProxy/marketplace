import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '@/db'
import { users } from '@/db/schema.ts'
import { createTokenHashSync } from '@/lib/Auth/tokens.ts'
import { matchesIfNoneMatch } from '@/lib/Request/etag.ts'
import { withSharedStorageMutationBarrier } from '@/server/Storage/storage-mutation-barrier.service.ts'
import {
    readCurrentUserBackgroundFileService,
    statCurrentUserBackgroundFileService,
} from '@/server/UserSettings/background-storage.service.ts'

const profileUserIdSchema = z.uuidv7()

function notFound(head: boolean) {
    return new Response(head ? null : 'Nicht gefunden.', {
        status: 404,
        headers: { 'cache-control': 'public, max-age=60' },
    })
}

function bannerEtag(userId: string, version: string) {
    return `W/"${createTokenHashSync(`profile-banner-v1:${userId}:${version}`)}"`
}

function bannerResponse(
    etag: string,
    size: number,
    notModified: boolean,
    bytes: Buffer<ArrayBuffer> | null,
) {
    const headers = new Headers({
        'cache-control': 'public, max-age=300, must-revalidate',
        etag,
    })
    if (notModified) return new Response(null, { status: 304, headers })
    headers.set('content-type', 'image/webp')
    headers.set('content-length', String(size))
    return new Response(bytes, { headers })
}

/** Public profile banner of a visible account; the id is validated before any path is built. */
export async function handlePublicProfileBannerService(
    request: Request,
    rawUserId: string,
) {
    const head = request.method === 'HEAD'
    const parsedUserId = profileUserIdSchema.safeParse(rawUserId)

    if (!parsedUserId.success) {
        return notFound(head)
    }

    const userId = parsedUserId.data
    const account = (
        await db
            .select({ id: users.id })
            .from(users)
            .where(
                and(
                    eq(users.id, userId),
                    eq(users.isDeleted, false),
                    eq(users.isActive, true),
                ),
            )
            .limit(1)
    ).at(0)

    if (!account) {
        return notFound(head)
    }

    const ifNoneMatch = request.headers.get('if-none-match')
    const response = await withSharedStorageMutationBarrier(async function () {
        if (head || ifNoneMatch !== null) {
            const metadata = await statCurrentUserBackgroundFileService(userId)
            if (!metadata) return null
            const etag = bannerEtag(userId, metadata.version)
            const notModified = matchesIfNoneMatch(ifNoneMatch, etag)
            if (head || notModified) {
                return bannerResponse(etag, metadata.size, notModified, null)
            }
        }
        const file = await readCurrentUserBackgroundFileService(userId)
        if (!file) return null
        const etag = bannerEtag(userId, file.version)
        return bannerResponse(
            etag,
            file.size,
            matchesIfNoneMatch(ifNoneMatch, etag),
            file.bytes,
        )
    })

    return response ?? notFound(head)
}
