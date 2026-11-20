import { createFileRoute } from '@tanstack/react-router'
import { UserRoundCheck } from 'lucide-react'
import { RouteErrorComponent } from '@/shared/RouteErrorComponent/RouteErrorComponent.tsx'
import useTranslationStore from '@/language/useTranslationStore.ts'
import HeadingIcon from '@/shared/HeadingIcon.tsx'

export const Route = createFileRoute('/_authenticated/user/dashboard')({
    component: RouteComponent,
    errorComponent: RouteErrorComponent,
})

function RouteComponent() {
    const { t } = useTranslationStore()

    return (
        <section
            aria-labelledby="user-dashboard-title"
            className="marketplace-content-panel flex max-w-2xl items-center gap-3 rounded-2xl border border-border-dark bg-surface-dark p-5 sm:p-6"
        >
            <HeadingIcon icon={UserRoundCheck} size="sm" />
            <h2 id="user-dashboard-title" className="sr-only">
                {t('user.dashboard.title')}
            </h2>
            <p className="text-sm font-medium text-foreground">
                {t('user.dashboard.loggedIn')}
            </p>
        </section>
    )
}
