import type { SyntheticEvent } from 'react'
import { getImageSrcKey } from '@/lib/Images/imageSrcKeys.ts'

export const DEFAULT_IMAGE_SRC = '/rentnerproxy-logo.png'
export const DEFAULT_IMAGE_64_SRC = '/rentnerproxy-logo.png'
export const DEFAULT_FAVICON_SRC = '/rentnerproxy-logo.png'

export function applyImageFallback(
    event: SyntheticEvent<HTMLImageElement>,
    fallbackSrc = DEFAULT_IMAGE_SRC,
) {
    const image = event.currentTarget

    if (
        getImageSrcKey(image.currentSrc || image.src) ===
        getImageSrcKey(fallbackSrc)
    ) {
        image.removeAttribute('src')
        return
    }

    image.src = fallbackSrc
}
