import { LayoutGrid, Package } from 'lucide-react'
import { USER_PROFILE_CONFIG } from '@/config/user-profile.config.ts'
import ProfileAppsList from '@/features/Social/Components/ProfileAppsList.tsx'
import useTranslationStore from '@/language/useTranslationStore.ts'
import HeadingIcon from '@/shared/HeadingIcon.tsx'
import type { ProfileAppsSectionProps } from '../Types/user-profile.types.ts'

/** Own published apps with their stars; placeholder slots until the first app. */
export default function ProfileAppsSection({
    username,
}: ProfileAppsSectionProps) {
    const { t } = useTranslationStore()
    const emptyState = (
        <ul className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {USER_PROFILE_CONFIG.appPlaceholderSlots.map((slot) => (
                <li
                    key={slot}
                    className="comic-hatch flex aspect-[4/3] flex-col items-center justify-center gap-3 rounded-md border-[3px] border-dashed border-border-dark text-secondary-text [--hatch-color:color-mix(in_oklab,var(--color-primary)_12%,transparent)]"
                >
                    <span className="grid h-14 w-14 place-items-center rounded-md border-2 border-dashed border-border-dark bg-surface-dark">
                        <Package aria-hidden="true" className="h-7 w-7" />
                    </span>
                    <span className="comic-lettering text-sm">
                        {t('profile.apps.placeholder', { number: slot })}
                    </span>
                </li>
            ))}
        </ul>
    )

    return (
        <section
            aria-labelledby="profile-apps-title"
            className="rounded-lg border border-border-dark bg-surface-dark p-5 sm:p-6"
        >
            <div className="flex flex-wrap items-center gap-3">
                <HeadingIcon icon={LayoutGrid} />
                <h2
                    id="profile-apps-title"
                    className="comic-title text-4xl text-foreground"
                >
                    {t('profile.apps.title')}
                </h2>
            </div>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-secondary-text">
                {t('profile.apps.description')}
            </p>
            <div className="mt-6">
                <ProfileAppsList
                    username={username}
                    isSignedIn
                    canEdit
                    emptyState={emptyState}
                />
            </div>
        </section>
    )
}
