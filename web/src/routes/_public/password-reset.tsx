import { createFileRoute } from '@tanstack/react-router'
import { RouteErrorComponent } from '@/shared/RouteErrorComponent/RouteErrorComponent.tsx'
import PasswordReset from '@/features/Auth/PasswordReset/index.tsx'

export const Route = createFileRoute('/_public/password-reset')({
    component: PasswordReset,
    errorComponent: RouteErrorComponent,
    head: () => ({
        meta: [{ name: 'referrer', content: 'no-referrer' }],
    }),
})
