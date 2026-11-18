import { createFileRoute } from '@tanstack/react-router'
import { handleCatalogPublicationRequest } from '@/server/Marketplace/Submissions/publication-http.service.ts'

export const Route = createFileRoute('/api/marketplace/v1/catalog-publication')(
    {
        server: { handlers: { POST: handleCatalogPublicationRequest } },
    },
)
