import ProfileAppCard from '@/features/Social/Components/ProfileAppCard.tsx'
import useTranslationStore from '@/language/useTranslationStore.ts'
import usePublishedAppsLogic from '../Hooks/usePublishedAppsLogic.ts'

/** Published apps with logo and stars; hidden until the first publication. */
export default function PublishedApps() {
    const { t } = useTranslationStore()
    const { state } = usePublishedAppsLogic()

    if (state.apps.length === 0) {
        return null
    }

    return (
        <section aria-labelledby="published-apps-title" className="mb-16">
            <h2
                id="published-apps-title"
                className="comic-title mb-6 text-4xl sm:text-5xl"
            >
                {t('appStore.catalogTitle')}
            </h2>
            <ul className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
                {state.apps.map((app) => (
                    <ProfileAppCard
                        key={app.appId}
                        app={app}
                        isSignedIn={state.isSignedIn}
                    />
                ))}
            </ul>
        </section>
    )
}
