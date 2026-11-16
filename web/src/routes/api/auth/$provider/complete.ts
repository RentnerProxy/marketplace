import { createFileRoute } from '@tanstack/react-router'
import { completeSocialLinkService } from '@/server/Auth/Social/flow.service.ts'
import { socialProviderSchema } from '@/server/Auth/Social/validation.ts'

export const Route = createFileRoute('/api/auth/$provider/complete')({
    server: { handlers: { GET: ({ params }) => completeSocialLinkService(socialProviderSchema.parse(params.provider)) } },
})
