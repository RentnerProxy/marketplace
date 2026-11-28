import { Link } from '@tanstack/react-router'
import { ExternalLink } from 'lucide-react'
import ProfileStats from '@/features/Social/Components/ProfileStats.tsx'
import useTranslationStore from '@/language/useTranslationStore.ts'
import type { ProfileHeroProps } from '../Types/user-profile.types.ts'
import ProfileAvatar from './ProfileAvatar.tsx'
import ProfileBanner from './ProfileBanner.tsx'
import ProfileBio from './ProfileBio.tsx'

export default function ProfileHero({
    appCount,
    starCount,
    bannerSrc,
    bio,
    followerCount,
    followingCount,
    profileImageSrc,
    userId,
    username,
}: ProfileHeroProps) {
    const { t } = useTranslationStore()

    return (
        <section
            aria-labelledby="profile-title"
            className="comic-panel relative isolate overflow-hidden bg-surface-dark text-foreground"
        >
            <ProfileBanner bannerSrc={bannerSrc} username={username} />

            <div className="relative px-5 pb-6 sm:px-8 sm:pb-8">
                <div className="flex flex-wrap items-end justify-between gap-4">
                    <div className="-mt-14 w-fit sm:-mt-20">
                        <ProfileAvatar
                            profileImageSrc={profileImageSrc}
                            userId={userId}
                            username={username}
                        />
                    </div>
                    {username && (
                        <Link
                            to="/u/$username"
                            params={{ username }}
                            className="comic-btn comic-btn-sm comic-btn-white mt-4"
                        >
                            <ExternalLink
                                aria-hidden="true"
                                className="h-4 w-4"
                            />
                            {t('social.viewPublicProfile')}
                        </Link>
                    )}
                </div>

                <div className="mt-4 min-w-0">
                    <h2
                        id="profile-title"
                        className="comic-title truncate text-5xl sm:text-6xl"
                    >
                        {username}
                    </h2>
                    <ProfileBio bio={bio} />
                    <div className="mt-6 flex flex-wrap gap-3">
                        <Link
                            to="/u/$username"
                            params={{ username }}
                            search={{ tab: 'followers' }}
                            className="comic-chip transition-transform hover:-translate-x-px hover:-translate-y-px"
                        >
                            <span className="tabular-nums">
                                {followerCount}
                            </span>
                            {t('social.followers')}
                        </Link>
                        <Link
                            to="/u/$username"
                            params={{ username }}
                            search={{ tab: 'following' }}
                            className="comic-chip transition-transform hover:-translate-x-px hover:-translate-y-px"
                        >
                            <span className="tabular-nums">
                                {followingCount}
                            </span>
                            {t('social.followingList')}
                        </Link>
                        <ProfileStats
                            appCount={appCount}
                            starCount={starCount}
                        />
                    </div>
                </div>
            </div>
        </section>
    )
}
