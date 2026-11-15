import { CustomTooltip } from '@rentnerkev/tooltips'
import type { UserProfileButtonProps } from '../Types/authenticated-layout-component-props.types.ts'
import useAuthenticatedSidebarLogic from '../Hooks/useAuthenticatedSidebarLogic.ts'
import useTranslationStore from '@/language/useTranslationStore.ts'
import { DEFAULT_IMAGE_64_SRC } from '@/lib/Images/imageFallbacks.ts'
import useResolvedImageSrc from '@/shared/Images/Hooks/useResolvedImageSrc.ts'

export default function UserProfileButton({
    isCollapsed,
    username,
    profileImageSrc,
}: UserProfileButtonProps) {
    const { handler } = useAuthenticatedSidebarLogic()
    const { t } = useTranslationStore()

    const profileImage = useResolvedImageSrc(
        profileImageSrc || DEFAULT_IMAGE_64_SRC,
        DEFAULT_IMAGE_64_SRC,
    )

    const profileButton = (
        <button
            type="button"
            onClick={handler.handleOpenUserSettings}
            className={`mb-2 flex h-13 w-full cursor-pointer items-center rounded-md border border-border-dark bg-input-dark/60 transition-colors hover:border-primary/40 hover:bg-input-dark ${
                isCollapsed ? 'justify-center' : 'gap-3 px-3 text-left'
            }`}
        >
            <img
                src={profileImage.state.imageSrc || DEFAULT_IMAGE_64_SRC}
                alt={username}
                loading="eager"
                decoding="sync"
                fetchPriority="high"
                onError={profileImage.handler.handleImageError}
                className="h-9 w-9 shrink-0 rounded-md border border-border-dark bg-background-dark object-contain"
            />
            {!isCollapsed && (
                <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-white">
                        {username}
                    </p>
                    <p className="truncate text-xs text-secondary-text">
                        {t('userSettings.settingsLabel')}
                    </p>
                </div>
            )}
        </button>
    )

    if (isCollapsed) {
        return (
            <CustomTooltip side="right" content={username}>
                {profileButton}
            </CustomTooltip>
        )
    }

    return profileButton
}
