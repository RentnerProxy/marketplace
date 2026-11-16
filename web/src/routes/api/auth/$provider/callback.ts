import { createFileRoute } from '@tanstack/react-router'
import { finishSocialCallbackService } from '@/server/Auth/Social/flow.service.ts'
import { socialProviderSchema } from '@/server/Auth/Social/validation.ts'

export const Route = createFileRoute('/api/auth/$provider/callback')({
    server: {
        handlers: {
            GET: ({ request, params }) => finishSocialCallbackService(request, socialProviderSchema.parse(params.provider)),
        },
    },
})
