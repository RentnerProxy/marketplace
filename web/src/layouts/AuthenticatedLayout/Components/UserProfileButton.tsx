import type { UserProfileButtonProps } from '../Types/authenticated-layout-component-props.types.ts'
import useAuthenticatedSidebarLogic from '../Hooks/useAuthenticatedSidebarLogic.ts'
import useTranslationStore from '@/language/useTranslationStore.ts'
import { DEFAULT_IMAGE_64_SRC } from '@/lib/Images/imageFallbacks.ts'
import useResolvedImageSrc from '@/shared/Images/Hooks/useResolvedImageSrc.ts'

export default function UserProfileButton({
    username,
    profileImageSrc,
    onNavigate,
}: UserProfileButtonProps) {
    const { handler } = useAuthenticatedSidebarLogic()
    const { t } = useTranslationStore()

    const profileImage = useResolvedImageSrc(
        profileImageSrc || DEFAULT_IMAGE_64_SRC,
        DEFAULT_IMAGE_64_SRC,
    )

    return (
        <button
            type="button"
            onClick={() => {
                onNavigate?.()
                handler.handleOpenUserSettings()
            }}
            className="mb-2 flex min-h-12 w-full cursor-pointer items-center gap-3 rounded-xl border border-white/10 bg-white/[0.04] px-3 text-left transition-colors hover:border-primary/35 hover:bg-primary/12 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary motion-reduce:transition-none"
        >
            <img
                src={profileImage.state.imageSrc || DEFAULT_IMAGE_64_SRC}
                alt={username}
                loading="eager"
                decoding="sync"
                fetchPriority="high"
                onError={profileImage.handler.handleImageError}
                className="size-8 shrink-0 rounded-lg bg-[#020a0b] object-cover"
            />
            <div className="min-w-0">
                <p className="truncate text-[0.82rem] font-extrabold text-[#f4f5f7]">
                    {username}
                </p>
                <p className="truncate text-[0.68rem] text-[#9fb5a9]">
                    {t('userSettings.settingsLabel')}
                </p>
            </div>
        </button>
    )
}
