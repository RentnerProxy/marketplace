import { useEffect, useRef, useState } from 'react'
import { readImageFileAsDataUrl } from '@/lib/Images/readImageFileAsDataUrl.ts'
import type {
    ImageCropArea,
    ImageCropPosition,
} from '@/shared/Types/image-crop.types.ts'
import type { ImageCropSelection } from '../Types/image-crop-selection.types.ts'

export default function useImageCropSelection(): ImageCropSelection {
    const [imageSrc, setImageSrc] = useState<string | null>(null)
    const [crop, setCrop] = useState<ImageCropPosition>({ x: 0, y: 0 })
    const [zoom, setZoom] = useState(1)
    const [croppedAreaPixels, setCroppedAreaPixels] =
        useState<ImageCropArea | null>(null)
    const selectionGeneration = useRef(0)

    useEffect(function () {
        return function () {
            selectionGeneration.current += 1
        }
    }, [])

    function handleSelectImage(file: File | null) {
        if (!file) return
        const generation = ++selectionGeneration.current
        readImageFileAsDataUrl(file, function (imageSource) {
            if (generation !== selectionGeneration.current) return
            setImageSrc(imageSource)
            setCrop({ x: 0, y: 0 })
            setZoom(1)
            setCroppedAreaPixels(null)
        })
    }

    function handleCropComplete(_: unknown, pixels: ImageCropArea) {
        setCroppedAreaPixels(pixels)
    }

    function handleClearSelectedImage() {
        selectionGeneration.current += 1
        setImageSrc(null)
    }

    function handleResetSelection() {
        handleClearSelectedImage()
        setCrop({ x: 0, y: 0 })
        setZoom(1)
        setCroppedAreaPixels(null)
    }

    return {
        state: { imageSrc, crop, zoom, croppedAreaPixels },
        handler: {
            handleSelectImage,
            handleCropComplete,
            handleResetSelection,
            handleClearSelectedImage,
        },
        setter: { setCrop, setZoom },
    }
}
