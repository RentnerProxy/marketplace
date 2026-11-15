import { DEFAULT_IMAGE_64_SRC } from '@/lib/Images/imageFallbacks.ts'
import { getProfileImageSrc } from '@/lib/Images/userImageUrls.ts'
import useResolvedImageSrc from '@/shared/Images/Hooks/useResolvedImageSrc.ts'
import useLocalProfileImageVersion from '@/shared/Images/Hooks/useLocalProfileImageVersion.ts'
import type { UserAvatarProps } from '../Types/user-management-component-props.types.ts'

export default function UserAvatar({
    userId,
    profileImageVersion,
    username,
}: UserAvatarProps) {
    const localProfileImageVersion = useLocalProfileImageVersion(
        userId,
        profileImageVersion,
    )
    const sourceImageSrc = getProfileImageSrc(
        userId,
        localProfileImageVersion ?? profileImageVersion,
        64,
    )
    const { state, handler } = useResolvedImageSrc(
        sourceImageSrc,
        DEFAULT_IMAGE_64_SRC,
    )

    return (
        <div className="flex h-9 w-9 items-center justify-center overflow-hidden rounded-md bg-input-dark text-secondary-text">
            <img
                src={state.imageSrc || DEFAULT_IMAGE_64_SRC}
                alt={`${username} Profilbild`}
                loading="lazy"
                decoding="async"
                onError={handler.handleImageError}
                className="h-full w-full object-cover"
            />
        </div>
    )
}
