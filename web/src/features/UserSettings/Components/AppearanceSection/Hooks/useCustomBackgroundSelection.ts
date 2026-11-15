import useImageCropSelection from '@/shared/Images/Hooks/useImageCropSelection.ts'
import { useEffect, useRef, useState } from 'react'
import type {
    ImageCropPosition,
    ImageCropSize,
} from '@/shared/Types/image-crop.types.ts'

export default function useCustomBackgroundSelection(
    customBackgroundSrc: string | null,
) {
    const containerRef = useRef<HTMLDivElement>(null)
    const [cropSize, setCropSize] = useState<ImageCropSize>({
        width: 0,
        height: 0,
    })
    const selection = useImageCropSelection()
    const {
        imageSrc: backgroundImageSrc,
        crop: backgroundCrop,
        zoom: backgroundZoom,
        croppedAreaPixels: backgroundCroppedAreaPixels,
    } = selection.state
    const { setCrop: setBackgroundCrop, setZoom: setBackgroundZoom } =
        selection.setter
    const {
        handleSelectImage: handleSelectBackgroundImage,
        handleCropComplete: handleBackgroundCropComplete,
        handleResetSelection: resetSelectedBackgroundImage,
    } = selection.handler
    const previewBackgroundSrc = backgroundImageSrc ?? customBackgroundSrc ?? ''

    useEffect(() => {
        if (!containerRef.current || !previewBackgroundSrc) {
            setCropSize({
                width: 0,
                height: 0,
            })
            return undefined
        }

        const observer = new ResizeObserver((entries) => {
            const firstEntry = entries.at(0)

            if (!firstEntry) {
                return
            }

            const { width, height } = firstEntry.contentRect

            if (width <= 0 || height <= 0) {
                return
            }

            setCropSize({
                width,
                height,
            })
        })

        observer.observe(containerRef.current)

        return () => observer.disconnect()
    }, [previewBackgroundSrc])

    const handleBackgroundCropChange: (nextCrop: ImageCropPosition) => void =
        setBackgroundCrop

    const handleBackgroundZoomChange: (nextZoom: number) => void =
        setBackgroundZoom

    return {
        refs: {
            containerRef,
        },
        handler: {
            handleBackgroundCropChange,
            handleBackgroundCropComplete,
            handleBackgroundZoomChange,
            handleResetSelectedBackgroundImage: resetSelectedBackgroundImage,
            handleSelectBackgroundImage,
        },
        state: {
            backgroundCrop,
            backgroundCroppedAreaPixels,
            backgroundImageSrc,
            backgroundZoom,
            cropSize,
            previewBackgroundSrc,
        },
    }
}
