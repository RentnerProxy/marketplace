import { createFileRoute } from '@tanstack/react-router'
import { RouteErrorComponent } from '@/shared/RouteErrorComponent/RouteErrorComponent.tsx'
import ForgotPassword from '@/features/Auth/ForgotPassword/index.tsx'

export const Route = createFileRoute('/_public/forgot-password')({
    component: ForgotPassword,
    errorComponent: RouteErrorComponent,
})
