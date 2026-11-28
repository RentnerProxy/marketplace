import { Link } from '@tanstack/react-router'
import { PencilLine, Store } from 'lucide-react'
import useTranslationStore from '@/language/useTranslationStore.ts'
import HeadingIcon from '@/shared/HeadingIcon.tsx'
import useEditableStoreAppsLogic from '../Hooks/useEditableStoreAppsLogic.ts'
import AppLogo from './AppLogo.tsx'

/** Own apps (any submission status) with a link to their store listing. */
export default function EditableStoreApps() {
    const { t } = useTranslationStore()
    const { state } = useEditableStoreAppsLogic()

    if (state.isLoading || state.apps.length === 0) {
        return null
    }

    return (
        <section
            aria-labelledby="editable-store-apps-title"
            className="rounded-xl border border-border-dark bg-surface-dark p-5"
        >
            <div className="flex flex-wrap items-center gap-3">
                <HeadingIcon icon={Store} />
                <h2
                    id="editable-store-apps-title"
                    className="comic-title text-3xl"
                >
                    {t('appStore.overviewTitle')}
                </h2>
            </div>
            <p className="mt-2 text-sm leading-6 text-secondary-text">
                {t('appStore.overviewDescription')}
            </p>
            <ul className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {state.apps.map((app) => (
                    <li
                        key={app.appId}
                        className="comic-card flex items-center gap-3 bg-background-dark p-3"
                    >
                        <AppLogo
                            logoSrc={app.logoSrc}
                            name={app.name}
                            size="sm"
                        />
                        <div className="min-w-0 flex-1">
                            <p className="truncate font-comic text-sm font-bold">
                                {app.name}
                            </p>
                            <p className="truncate text-xs text-secondary-text">
                                {t(`submissions.status.${app.status}`)}
                            </p>
                        </div>
                        <Link
                            to="/user/app-store/$appId"
                            params={{ appId: app.appId }}
                            className="comic-btn comic-btn-sm comic-btn-white"
                        >
                            <PencilLine
                                aria-hidden="true"
                                className="h-4 w-4"
                            />
                            {t('appStore.edit')}
                        </Link>
                    </li>
                ))}
            </ul>
        </section>
    )
}
