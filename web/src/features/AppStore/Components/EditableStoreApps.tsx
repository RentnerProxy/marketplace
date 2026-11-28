import { Link } from '@tanstack/react-router'
import { PencilLine } from 'lucide-react'
import useTranslationStore from '@/language/useTranslationStore.ts'
import useEditableStoreAppsLogic from '../Hooks/useEditableStoreAppsLogic.ts'
import AppLogo from './AppLogo.tsx'

/** Own apps (any submission status) with a link to their store listing. */
export default function EditableStoreApps() {
    const { t } = useTranslationStore()
    const { state } = useEditableStoreAppsLogic()

    if (state.isLoading) {
        return null
    }

    if (state.apps.length === 0) {
        return (
            <p className="comic-hatch rounded-md border-[3px] border-dashed border-border-dark px-4 py-6 text-center text-sm text-secondary-text [--hatch-color:color-mix(in_oklab,var(--color-primary)_10%,transparent)]">
                {t('appStore.overviewEmpty')}
            </p>
        )
    }

    return (
        <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {state.apps.map((app) => (
                <li
                    key={app.appId}
                    className="comic-card flex items-center gap-3 bg-background-dark p-3"
                >
                    <AppLogo logoSrc={app.logoSrc} name={app.name} size="sm" />
                    <div className="min-w-0 flex-1">
                        <p className="truncate font-comic text-sm font-bold">
                            {app.name}
                        </p>
                        <p className="truncate text-xs text-secondary-text">
                            {t(`submissions.status.${app.status}`)}
                        </p>
                    </div>
                    <Link
                        to="/user/app-submissions/$appId"
                        params={{ appId: app.appId }}
                        className="comic-btn comic-btn-sm comic-btn-white"
                    >
                        <PencilLine aria-hidden="true" className="h-4 w-4" />
                        {t('appStore.edit')}
                    </Link>
                </li>
            ))}
        </ul>
    )
}
