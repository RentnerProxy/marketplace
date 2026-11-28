import { createFileRoute } from '@tanstack/react-router'
import { handlePublicProfileBannerService } from '@/server/Social/banner.service.ts'

export const Route = createFileRoute('/api/profiles/$userId/banner')({
    server: {
        handlers: {
            GET: function ({ request, params }) {
                return handlePublicProfileBannerService(request, params.userId)
            },
            HEAD: function ({ request, params }) {
                return handlePublicProfileBannerService(request, params.userId)
            },
        },
    },
})
