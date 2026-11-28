import { LayoutGrid, Palette, ShieldCheck } from 'lucide-react'
import AppearanceSection from '@/features/UserSettings/Components/AppearanceSection/index.tsx'
import SecuritySection from '@/features/UserSettings/Components/SecuritySection/index.tsx'
import useTranslationStore from '@/language/useTranslationStore.ts'
import SegmentedTabs from '@/shared/SegmentedTabs.tsx'
import ProfileAppsSection from './Components/ProfileAppsSection.tsx'
import ProfileHero from './Components/ProfileHero.tsx'
import useUserProfilePageLogic from './Hooks/useUserProfilePageLogic.ts'

export default function UserProfilePage() {
    const { t } = useTranslationStore()
    const { state, handler } = useUserProfilePageLogic()

    return (
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
            <ProfileHero
                appCount={state.appCount}
                starCount={state.starCount}
                bannerSrc={state.bannerSrc}
                bio={state.bio}
                followerCount={state.followerCount}
                followingCount={state.followingCount}
                profileImageSrc={state.profileImageSrc}
                userId={state.userId}
                username={state.username}
            />

            <SegmentedTabs
                activeTab={state.activeTab}
                columns={3}
                onTabChange={handler.handleTabChange}
                tabs={[
                    {
                        key: 'apps',
                        icon: LayoutGrid,
                        label: t('profile.tabs.apps'),
                    },
                    {
                        key: 'appearance',
                        icon: Palette,
                        label: t('userSettings.appearance'),
                    },
                    {
                        key: 'security',
                        icon: ShieldCheck,
                        label: t('userSettings.security.label'),
                    },
                ]}
            />

            {state.activeTab === 'apps' && (
                <ProfileAppsSection username={state.username} />
            )}

            {state.activeTab === 'appearance' && <AppearanceSection />}

            {state.activeTab === 'security' && <SecuritySection />}
        </div>
    )
}
