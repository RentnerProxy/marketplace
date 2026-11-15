import type { Dispatch, SetStateAction } from 'react'
import type {
    ImageCropArea,
    ImageCropPosition,
} from '@/shared/Types/image-crop.types.ts'

export type ImageCropSelection = {
    state: {
        imageSrc: string | null
        crop: ImageCropPosition
        zoom: number
        croppedAreaPixels: ImageCropArea | null
    }
    handler: {
        handleSelectImage: (file: File | null) => void
        handleCropComplete: (_: unknown, pixels: ImageCropArea) => void
        handleResetSelection: () => void
        handleClearSelectedImage: () => void
    }
    setter: {
        setCrop: Dispatch<SetStateAction<ImageCropPosition>>
        setZoom: Dispatch<SetStateAction<number>>
    }
}
