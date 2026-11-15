import { createFileRoute } from '@tanstack/react-router'
import { RouteErrorComponent } from '@/shared/RouteErrorComponent/RouteErrorComponent.tsx'
import useTranslationStore from '@/language/useTranslationStore.ts'

export const Route = createFileRoute('/_authenticated/user/dashboard')({
    component: RouteComponent,
    errorComponent: RouteErrorComponent,
})

function RouteComponent() {
    const { t } = useTranslationStore()

    return (
        <div className="rounded-xl border border-border-dark bg-surface-dark p-6">
            <h1 className="text-2xl font-bold text-white">
                {t('user.dashboard.title')}
            </h1>
            <p className="mt-2 text-secondary-text">
                {t('user.dashboard.loggedIn')}
            </p>
        </div>
    )
}
