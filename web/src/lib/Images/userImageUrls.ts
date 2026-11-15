import {
    DEFAULT_IMAGE_64_SRC,
    DEFAULT_IMAGE_SRC,
} from '@/lib/Images/imageFallbacks.ts'

export function getProfileImageSrc(
    userId: string | undefined,
    version: number | null | undefined,
    size?: 64,
) {
    if (!userId || !version) {
        return size === 64 ? DEFAULT_IMAGE_64_SRC : DEFAULT_IMAGE_SRC
    }

    const versionSearch = `?v=${version}`

    return size === 64
        ? `/images/user/${userId}/profile-64.webp${versionSearch}`
        : `/images/user/${userId}/profile.webp${versionSearch}`
}

export function getUserBackgroundSrc(
    userId: string | undefined,
    version: string | null | undefined,
) {
    if (!userId || !version) {
        return null
    }

    return `/api/user/background?v=${encodeURIComponent(version)}`
}
