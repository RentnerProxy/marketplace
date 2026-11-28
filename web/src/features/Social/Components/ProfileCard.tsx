import { Link } from '@tanstack/react-router'
import useTranslationStore from '@/language/useTranslationStore.ts'
import {
    applyImageFallback,
    DEFAULT_IMAGE_64_SRC,
} from '@/lib/Images/imageFallbacks.ts'
import { getProfileImageSrc } from '@/lib/Images/userImageUrls.ts'
import type { ProfileCardProps } from '../Types/social-component.types.ts'
import FollowButton from './FollowButton.tsx'

/** Account row for search results and follower lists. */
export default function ProfileCard({ profile, isSignedIn }: ProfileCardProps) {
    const { t } = useTranslationStore()

    return (
        <li className="flex items-center gap-4 rounded-md border-2 border-border-dark bg-surface-dark p-4 shadow-[3px_3px_0_0_var(--app-comic-shadow,var(--color-ink))]">
            <Link
                to="/u/$username"
                params={{ username: profile.username }}
                className="comic-focus flex min-w-0 flex-1 items-center gap-4 rounded-md"
            >
                <img
                    src={getProfileImageSrc(
                        profile.id,
                        profile.profileImageVersion,
                        64,
                    )}
                    onError={(event) =>
                        applyImageFallback(event, DEFAULT_IMAGE_64_SRC)
                    }
                    alt=""
                    className="h-14 w-14 shrink-0 rounded-full border-[3px] border-ink bg-mist-100 object-cover"
                />
                <span className="min-w-0">
                    <span className="flex flex-wrap items-center gap-2">
                        <span className="truncate font-display text-2xl leading-none tracking-[0.03em] text-foreground">
                            {profile.username}
                        </span>
                        {profile.isTeam && (
                            <span className="comic-chip comic-chip-green px-2 py-0.5 text-[11px] uppercase">
                                {t('social.team')}
                            </span>
                        )}
                        {profile.isSelf && (
                            <span className="comic-chip px-2 py-0.5 text-[11px] uppercase">
                                {t('social.you')}
                            </span>
                        )}
                    </span>
                    {profile.bio && (
                        <span className="mt-1 line-clamp-2 block text-sm leading-6 text-secondary-text">
                            {profile.bio}
                        </span>
                    )}
                </span>
            </Link>
            <FollowButton profile={profile} isSignedIn={isSignedIn} />
        </li>
    )
}
