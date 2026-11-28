import { createFileRoute } from '@tanstack/react-router'
import AppCatalogPage from '@/features/AppCatalog/index.tsx'
import { RouteErrorComponent } from '@/shared/RouteErrorComponent/RouteErrorComponent.tsx'

export const Route = createFileRoute('/_authenticated/user/catalog')({
    component: AppCatalogPage,
    errorComponent: RouteErrorComponent,
})
