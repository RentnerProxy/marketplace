import { Link } from '@tanstack/react-router'
import { CalendarDays, PencilLine } from 'lucide-react'
import FollowButton from '@/features/Social/Components/FollowButton.tsx'
import ProfileStats from '@/features/Social/Components/ProfileStats.tsx'
import useTranslationStore from '@/language/useTranslationStore.ts'
import {
    applyImageFallback,
    DEFAULT_IMAGE_SRC,
} from '@/lib/Images/imageFallbacks.ts'
import MascotImage from '@/shared/Brand/MascotImage.tsx'
import type { PublicProfileHeroProps } from '../Types/public-profile.types.ts'

export default function PublicProfileHero({
    bannerSrc,
    isSignedIn,
    joinedLabel,
    profile,
    profileImageSrc,
    onShowList,
}: PublicProfileHeroProps) {
    const { t } = useTranslationStore()

    return (
        <section
            aria-labelledby="public-profile-title"
            className="comic-panel relative isolate overflow-hidden bg-surface-dark text-foreground"
        >
            <div className="relative aspect-[3/1] w-full overflow-hidden border-b-4 border-[var(--comic-edge,var(--color-ink))]">
                {bannerSrc ? (
                    <img
                        src={bannerSrc}
                        alt={t('profile.banner.alt', {
                            username: profile.username,
                        })}
                        className="h-full w-full object-cover"
                    />
                ) : (
                    <div
                        aria-hidden="true"
                        className="absolute inset-0 overflow-hidden bg-proxy-400"
                    >
                        <div className="comic-rays absolute left-[78%] top-1/2 aspect-square w-[140%] -translate-x-1/2 -translate-y-1/2 [--rays-a:rgba(255,255,255,0.3)]" />
                        <div className="comic-hatch absolute bottom-0 left-0 h-2/3 w-1/2 [mask-image:linear-gradient(45deg,black,transparent_70%)]" />
                        <MascotImage
                            mascot="proxyBox"
                            sizes="(min-width: 640px) 11rem, 8rem"
                            className="absolute -bottom-8 right-6 w-32 drop-shadow-[5px_5px_0_var(--color-ink)] sm:right-12 sm:w-44"
                        />
                    </div>
                )}
            </div>

            <div className="relative px-5 pb-6 sm:px-8 sm:pb-8">
                <div className="flex flex-wrap items-end justify-between gap-4">
                    <img
                        src={profileImageSrc}
                        alt={profile.username}
                        onError={(event) =>
                            applyImageFallback(event, DEFAULT_IMAGE_SRC)
                        }
                        className="relative z-10 -mt-14 h-28 w-28 shrink-0 rounded-full border-4 border-ink bg-mist-100 object-cover shadow-[4px_4px_0_0_var(--app-comic-pop,var(--color-ink))] sm:-mt-20 sm:h-40 sm:w-40"
                    />
                    <div className="pt-4">
                        {profile.isSelf ? (
                            <Link
                                to="/profile"
                                className="comic-btn comic-btn-sm comic-btn-white"
                            >
                                <PencilLine
                                    aria-hidden="true"
                                    className="h-4 w-4"
                                />
                                {t('nav.profile')}
                            </Link>
                        ) : (
                            <FollowButton
                                profile={profile}
                                isSignedIn={isSignedIn}
                            />
                        )}
                    </div>
                </div>

                <div className="mt-4 min-w-0">
                    <div className="flex flex-wrap items-center gap-3">
                        <h1
                            id="public-profile-title"
                            className="comic-title truncate text-5xl sm:text-6xl"
                        >
                            {profile.username}
                        </h1>
                        {profile.isTeam && (
                            <span className="comic-chip comic-chip-green uppercase">
                                {t('social.team')}
                            </span>
                        )}
                    </div>
                    <p className="comic-lettering mt-2 flex items-center gap-2 text-xs text-secondary-text">
                        <CalendarDays aria-hidden="true" className="h-4 w-4" />
                        {t('social.joined', { date: joinedLabel })}
                    </p>
                    {profile.bio && (
                        <p className="mt-4 max-w-2xl whitespace-pre-line break-words text-base leading-7">
                            {profile.bio}
                        </p>
                    )}
                    <div className="mt-6 flex flex-wrap gap-3">
                        <button
                            type="button"
                            onClick={() => onShowList('followers')}
                            className="comic-chip cursor-pointer transition-transform hover:-translate-x-px hover:-translate-y-px"
                        >
                            <span className="tabular-nums">
                                {profile.followerCount}
                            </span>
                            {t('social.followers')}
                        </button>
                        <button
                            type="button"
                            onClick={() => onShowList('following')}
                            className="comic-chip cursor-pointer transition-transform hover:-translate-x-px hover:-translate-y-px"
                        >
                            <span className="tabular-nums">
                                {profile.followingCount}
                            </span>
                            {t('social.followingList')}
                        </button>
                        <ProfileStats
                            appCount={profile.appCount}
                            starCount={profile.starCount}
                        />
                    </div>
                </div>
            </div>
        </section>
    )
}
