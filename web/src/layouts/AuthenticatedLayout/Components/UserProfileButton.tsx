import { Link } from '@tanstack/react-router'
import type { UserProfileButtonProps } from '../Types/authenticated-layout-component-props.types.ts'
import useTranslationStore from '@/language/useTranslationStore.ts'
import { DEFAULT_IMAGE_64_SRC } from '@/lib/Images/imageFallbacks.ts'
import useResolvedImageSrc from '@/shared/Images/Hooks/useResolvedImageSrc.ts'

export default function UserProfileButton({
    username,
    profileImageSrc,
    onNavigate,
}: UserProfileButtonProps) {
    const { t } = useTranslationStore()
    const profileImage = useResolvedImageSrc(
        profileImageSrc || DEFAULT_IMAGE_64_SRC,
        DEFAULT_IMAGE_64_SRC,
    )

    return (
        <Link
            to="/profile"
            preload={false}
            onClick={onNavigate}
            className="comic-focus mb-2 flex min-h-13 w-full items-center gap-3 rounded-md border-2 border-ink bg-white px-2.5 text-ink shadow-[3px_3px_0_0_var(--color-proxy-500)] transition-[transform,background-color] hover:-translate-x-px hover:-translate-y-px data-[status=active]:bg-proxy-400 data-[status=active]:text-on-proxy motion-reduce:transition-none"
        >
            <img
                src={profileImage.state.imageSrc || DEFAULT_IMAGE_64_SRC}
                alt={username}
                loading="eager"
                decoding="sync"
                fetchPriority="high"
                onError={profileImage.handler.handleImageError}
                className="size-9 shrink-0 rounded-full border-2 border-ink bg-mist-100 object-cover"
            />
            <div className="min-w-0">
                <p className="truncate font-comic text-sm font-bold">
                    {username}
                </p>
                <p className="comic-lettering truncate text-[11px] opacity-75">
                    {t('nav.profile')}
                </p>
            </div>
        </Link>
    )
}
