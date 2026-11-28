import { useEffect, useState } from 'react'
import type { ScreenshotGalleryLogicReturn } from '../Types/app-store-component.types.ts'

/** Carousel index with wrap-around and a keyboard-driven lightbox. */
export default function useScreenshotGalleryLogic(
    count: number,
): ScreenshotGalleryLogicReturn {
    const [activeIndex, setActiveIndex] = useState(0)
    const [isLightboxOpen, setIsLightboxOpen] = useState(false)
    const safeIndex = count > 0 ? Math.min(activeIndex, count - 1) : 0

    function handlePrevious() {
        if (count > 0) setActiveIndex((safeIndex - 1 + count) % count)
    }

    function handleNext() {
        if (count > 0) setActiveIndex((safeIndex + 1) % count)
    }

    useEffect(
        function () {
            function handleKeyDown(event: KeyboardEvent) {
                if (count === 0) return
                if (event.key === 'Escape') setIsLightboxOpen(false)
                if (event.key === 'ArrowLeft') {
                    setActiveIndex((index) => (index - 1 + count) % count)
                }
                if (event.key === 'ArrowRight') {
                    setActiveIndex((index) => (index + 1) % count)
                }
            }

            if (isLightboxOpen) {
                window.addEventListener('keydown', handleKeyDown)
            }
            return function () {
                window.removeEventListener('keydown', handleKeyDown)
            }
        },
        [isLightboxOpen, count],
    )

    return {
        state: { activeIndex: safeIndex, isLightboxOpen },
        handler: {
            handleSelect: setActiveIndex,
            handlePrevious,
            handleNext,
            handleOpenLightbox: () => setIsLightboxOpen(true),
            handleCloseLightbox: () => setIsLightboxOpen(false),
        },
    }
}
