import { LoaderCircle } from 'lucide-react'
import useTranslationStore from '@/language/useTranslationStore.ts'
import useProfileFollowListLogic from '../Hooks/useProfileFollowListLogic.ts'
import type { ProfileFollowListProps } from '../Types/social-component.types.ts'
import ProfileCard from './ProfileCard.tsx'

export default function ProfileFollowList({
    username,
    list,
    isSignedIn,
}: ProfileFollowListProps) {
    const { t } = useTranslationStore()
    const { state, handler } = useProfileFollowListLogic(username, list)

    if (state.isLoading) {
        return (
            <div className="flex justify-center py-10 text-secondary-text">
                <LoaderCircle
                    aria-hidden="true"
                    className="h-6 w-6 animate-spin"
                />
            </div>
        )
    }

    if (state.profiles.length === 0) {
        return (
            <p className="comic-lettering rounded-md border-[3px] border-dashed border-border-dark px-5 py-10 text-center text-sm text-secondary-text">
                {list === 'followers'
                    ? t('social.emptyFollowers')
                    : t('social.emptyFollowing')}
            </p>
        )
    }

    return (
        <div className="flex flex-col gap-4">
            <ul className="grid gap-4 lg:grid-cols-2">
                {state.profiles.map((profile) => (
                    <ProfileCard
                        key={profile.id}
                        profile={profile}
                        isSignedIn={isSignedIn}
                    />
                ))}
            </ul>
            {state.hasMore && (
                <button
                    type="button"
                    onClick={handler.handleLoadMore}
                    disabled={state.isLoadingMore}
                    className="comic-btn comic-btn-sm comic-btn-white mx-auto"
                >
                    {state.isLoadingMore && (
                        <LoaderCircle
                            aria-hidden="true"
                            className="h-4 w-4 animate-spin"
                        />
                    )}
                    {t('social.loadMore')}
                </button>
            )}
        </div>
    )
}
