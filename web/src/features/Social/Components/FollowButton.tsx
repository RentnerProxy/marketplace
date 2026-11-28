import { Link } from '@tanstack/react-router'
import { CustomTooltip } from '@rentnerkev/tooltips'
import { LoaderCircle, LogIn, UserCheck, UserPlus } from 'lucide-react'
import useTranslationStore from '@/language/useTranslationStore.ts'
import useFollowButtonLogic from '../Hooks/useFollowButtonLogic.ts'
import type { FollowButtonProps } from '../Types/social-component.types.ts'

export default function FollowButton({
    profile,
    isSignedIn,
}: FollowButtonProps) {
    const { t } = useTranslationStore()
    const { state, handler } = useFollowButtonLogic(profile)

    if (profile.isSelf) {
        return null
    }

    if (!isSignedIn) {
        return (
            <Link to="/login" className="comic-btn comic-btn-sm">
                <LogIn aria-hidden="true" className="h-4 w-4" />
                {t('social.loginToFollow')}
            </Link>
        )
    }

    const Icon = state.isPending
        ? LoaderCircle
        : profile.isFollowing
          ? UserCheck
          : UserPlus
    const button = (
        <button
            type="button"
            aria-pressed={profile.isFollowing}
            disabled={state.isPending}
            onClick={handler.handleToggleFollow}
            className={`comic-btn comic-btn-sm ${profile.isFollowing ? 'comic-btn-white' : ''}`}
        >
            <Icon
                aria-hidden="true"
                className={`h-4 w-4 ${state.isPending ? 'animate-spin' : ''}`}
            />
            {profile.isFollowing ? t('social.following') : t('social.follow')}
        </button>
    )

    return profile.isFollowing ? (
        <CustomTooltip side="top" content={t('social.unfollow')}>
            {button}
        </CustomTooltip>
    ) : (
        button
    )
}
