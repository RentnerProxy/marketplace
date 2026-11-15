import { createFileRoute } from '@tanstack/react-router'
import { requireAuthenticatedFeatureAccessService } from '@/server/Auth/authorization.service.ts'
import { AuthenticationRequiredError } from '@/server/Auth/authorization.errors.ts'
import { MaintenanceModeError } from '@/server/Maintenance/access.errors.ts'
import { withSharedStorageMutationBarrier } from '@/server/Storage/storage-mutation-barrier.service.ts'
import { readCurrentUserBackgroundFileService } from '@/server/UserSettings/background-storage.service.ts'

export async function handleCurrentUserBackground(request: Request) {
    const access = await requireAuthenticatedFeatureAccessService().catch(
        function (error: unknown) {
            if (error instanceof AuthenticationRequiredError) {
                return new Response('Nicht angemeldet.', {
                    status: 401,
                    headers: { 'cache-control': 'private, no-store' },
                })
            }

            if (error instanceof MaintenanceModeError) {
                return new Response(
                    request.method === 'HEAD' ? null : error.message,
                    {
                        status: 503,
                        headers: { 'cache-control': 'private, no-store' },
                    },
                )
            }

            throw error
        },
    )

    if (access instanceof Response) {
        return access
    }

    const fileBuffer = await withSharedStorageMutationBarrier(function () {
        return readCurrentUserBackgroundFileService(access.sessionUser.id)
    })

    if (!fileBuffer) {
        return new Response('Nicht gefunden.', {
            status: 404,
            headers: { 'cache-control': 'private, no-store' },
        })
    }

    return new Response(
        request.method === 'HEAD' ? null : new Uint8Array(fileBuffer),
        {
            headers: {
                'cache-control': 'private, no-cache, must-revalidate',
                'content-type': 'image/webp',
            },
        },
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
