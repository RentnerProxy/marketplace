import type { SyntheticEvent } from 'react'
import { useMemo, useState } from 'react'
import { getImageSrcKey } from '@/lib/Images/imageSrcKeys.ts'

const failedImageSrcKeys = new Set<string>()

export default function useResolvedImageSrc(src: string, fallbackSrc: string) {
    const sourceKey = useMemo(() => getImageSrcKey(src), [src])
    const fallbackKey = useMemo(
        () => getImageSrcKey(fallbackSrc),
        [fallbackSrc],
    )
    const [resolvedImageState, setResolvedImageState] = useState(function () {
        return {
            fallbackSrc,
            imageSrc: failedImageSrcKeys.has(sourceKey) ? fallbackSrc : src,
            sourceKey,
            src,
        }
    })

    if (
        fallbackSrc !== resolvedImageState.fallbackSrc ||
        sourceKey !== resolvedImageState.sourceKey ||
        src !== resolvedImageState.src
    ) {
        setResolvedImageState({
            fallbackSrc,
            imageSrc: failedImageSrcKeys.has(sourceKey) ? fallbackSrc : src,
            sourceKey,
            src,
        })
    }

    const imageSrc =
        fallbackSrc === resolvedImageState.fallbackSrc &&
        sourceKey === resolvedImageState.sourceKey &&
        src === resolvedImageState.src
            ? resolvedImageState.imageSrc
            : failedImageSrcKeys.has(sourceKey)
              ? fallbackSrc
              : src

    function handleImageError(event: SyntheticEvent<HTMLImageElement>) {
        const failedSrc =
            event.currentTarget.currentSrc || event.currentTarget.src || src
        const failedKey = getImageSrcKey(failedSrc)

        if (failedKey === fallbackKey) {
            setResolvedImageState((current) => ({
                ...current,
                imageSrc: '',
            }))
            return
        }

        failedImageSrcKeys.add(failedKey)
        failedImageSrcKeys.add(sourceKey)
        setResolvedImageState((current) => ({
            ...current,
            imageSrc: fallbackSrc,
        }))
    }

    return {
        state: {
            imageSrc,
        },
        handler: {
            handleImageError,
        },
    }
}
