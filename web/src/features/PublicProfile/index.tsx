import { LayoutGrid, Package, UserCheck, UsersRound } from 'lucide-react'
import ProfileAppsList from '@/features/Social/Components/ProfileAppsList.tsx'
import ProfileFollowList from '@/features/Social/Components/ProfileFollowList.tsx'
import useTranslationStore from '@/language/useTranslationStore.ts'
import SegmentedTabs from '@/shared/SegmentedTabs.tsx'
import PublicProfileHero from './Components/PublicProfileHero.tsx'
import usePublicProfilePageLogic from './Hooks/usePublicProfilePageLogic.ts'
import type { PublicProfilePageProps } from './Types/public-profile.types.ts'

export default function PublicProfilePage({
    username,
}: PublicProfilePageProps) {
    const { t } = useTranslationStore()
    const { state, handler } = usePublicProfilePageLogic(username)
    const profile = state.profile

    if (!profile) {
        return null
    }

    return (
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-2 py-6 sm:px-4 sm:py-8">
            <PublicProfileHero
                bannerSrc={state.bannerSrc}
                isSignedIn={state.isSignedIn}
                joinedLabel={state.joinedLabel}
                profile={profile}
                profileImageSrc={state.profileImageSrc}
                onShowList={handler.handleTabChange}
            />

            <SegmentedTabs
                activeTab={state.activeTab}
                columns={3}
                onTabChange={handler.handleTabChange}
                tabs={[
                    {
                        key: 'apps',
                        icon: LayoutGrid,
                        label: t('social.appsTitle'),
                    },
                    {
                        key: 'followers',
                        icon: UsersRound,
                        label: `${t('social.followers')} · ${profile.followerCount}`,
                    },
                    {
                        key: 'following',
                        icon: UserCheck,
                        label: `${t('social.followingList')} · ${profile.followingCount}`,
                    },
                ]}
            />

            {state.activeTab === 'apps' ? (
                <ProfileAppsList
                    username={profile.username}
                    isSignedIn={state.isSignedIn}
                    emptyState={
                        <section className="comic-hatch flex flex-col items-center gap-3 rounded-md border-[3px] border-dashed border-ink/40 px-5 py-12 text-center [--hatch-color:color-mix(in_oklab,var(--color-primary)_12%,transparent)]">
                            <Package aria-hidden="true" className="h-8 w-8" />
                            <p className="max-w-md text-sm leading-6">
                                {t('social.appsEmpty', {
                                    username: profile.username,
                                })}
                            </p>
                        </section>
                    }
                />
            ) : (
                <ProfileFollowList
                    key={state.activeTab}
                    username={profile.username}
                    list={state.activeTab}
                    isSignedIn={state.isSignedIn}
                />
            )}
        </div>
    )
}
