import { LoaderCircle } from 'lucide-react'
import useTranslationStore from '@/language/useTranslationStore.ts'
import useProfileAppsListLogic from '../Hooks/useProfileAppsListLogic.ts'
import type { ProfileAppsListProps } from '../Types/social-component.types.ts'
import ProfileAppCard from './ProfileAppCard.tsx'

/** Published apps of a profile; renders the given empty state without apps. */
export default function ProfileAppsList({
    username,
    isSignedIn,
    canEdit = false,
    emptyState,
}: ProfileAppsListProps) {
    const { t } = useTranslationStore()
    const { state } = useProfileAppsListLogic(username)

    if (state.isLoading) {
        return (
            <p className="comic-lettering flex items-center justify-center gap-2 py-10 text-sm text-secondary-text">
                <LoaderCircle
                    aria-hidden="true"
                    className="h-4 w-4 animate-spin"
                />
                {t('social.appsLoading')}
            </p>
        )
    }

    if (state.apps.length === 0) {
        return emptyState
    }

    return (
        <ul className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {state.apps.map((app) => (
                <ProfileAppCard
                    key={app.appId}
                    app={app}
                    isSignedIn={isSignedIn}
                    canEdit={canEdit}
                />
            ))}
        </ul>
    )
}
