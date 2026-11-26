import { createFileRoute } from '@tanstack/react-router'
import { createTokenHashSync } from '@/lib/Auth/tokens.ts'
import { matchesIfNoneMatch } from '@/lib/Request/etag.ts'
import { requireAuthenticatedFeatureAccessService } from '@/server/Auth/authorization.service.ts'
import { AuthenticationRequiredError } from '@/server/Auth/authorization.errors.ts'
import { MaintenanceModeError } from '@/server/Maintenance/access.errors.ts'
import { withSharedStorageMutationBarrier } from '@/server/Storage/storage-mutation-barrier.service.ts'
import {
    readCurrentUserBackgroundFileService,
    statCurrentUserBackgroundFileService,
} from '@/server/UserSettings/background-storage.service.ts'

function backgroundEtag(userId: string, version: string) {
    return `W/"${createTokenHashSync(`background-v1:${userId}:${version}`)}"`
}

function backgroundResponse(
    etag: string,
    size: number,
    notModified: boolean,
    bytes: Buffer<ArrayBuffer> | null,
) {
    const headers = new Headers({
        'cache-control': 'private, no-cache, must-revalidate',
        etag,
        vary: 'Cookie',
    })
    if (notModified) return new Response(null, { status: 304, headers })
    headers.set('content-type', 'image/webp')
    headers.set('content-length', String(size))
    return new Response(bytes, { headers })
}

export async function handleCurrentUserBackground(request: Request) {
    const head = request.method === 'HEAD'
    const access = await requireAuthenticatedFeatureAccessService().catch(
        function (error: unknown) {
            if (error instanceof AuthenticationRequiredError) {
                return new Response(head ? null : 'Nicht angemeldet.', {
                    status: 401,
                    headers: { 'cache-control': 'private, no-store' },
                })
            }

            if (error instanceof MaintenanceModeError) {
                return new Response(head ? null : error.message, {
                    status: 503,
                    headers: { 'cache-control': 'private, no-store' },
                })
            }

            throw error
        },
    )

    if (access instanceof Response) {
        return access
    }

    const userId = access.sessionUser.id
    const ifNoneMatch = request.headers.get('if-none-match')
    const response = await withSharedStorageMutationBarrier(async function () {
        if (head || ifNoneMatch !== null) {
            const metadata = await statCurrentUserBackgroundFileService(userId)
            if (!metadata) return null
            const etag = backgroundEtag(userId, metadata.version)
            const notModified = matchesIfNoneMatch(ifNoneMatch, etag)
            if (head || notModified) {
                return backgroundResponse(
                    etag,
                    metadata.size,
                    notModified,
                    null,
                )
            }
        }
        const file = await readCurrentUserBackgroundFileService(userId)
        if (!file) return null
        const etag = backgroundEtag(userId, file.version)
        return backgroundResponse(
            etag,
            file.size,
            matchesIfNoneMatch(ifNoneMatch, etag),
            file.bytes,
        )
    })

    return (
        response ??
        new Response(head ? null : 'Nicht gefunden.', {
            status: 404,
            headers: { 'cache-control': 'private, no-store' },
        })
    )
}

export const Route = createFileRoute('/api/user/background')({
    server: {
        handlers: {
            GET: function ({ request }) {
                return handleCurrentUserBackground(request)
            },
            HEAD: function ({ request }) {
                return handleCurrentUserBackground(request)
            },
        },
    },
})
