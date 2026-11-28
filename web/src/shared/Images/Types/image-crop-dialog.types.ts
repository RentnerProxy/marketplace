import type {
    ImageCropArea,
    ImageCropPosition,
} from '@/shared/Types/image-crop.types.ts'

export type ImageCropDialogProps = {
    titleId: string
    title: string
    hint: string
    imageSrc: string
    crop: ImageCropPosition
    zoom: number
    aspect: number
    isSaving: boolean
    saveLabel: string
    onCropChange: (crop: ImageCropPosition) => void
    onZoomChange: (zoom: number) => void
    onCropComplete: (_: unknown, pixels: ImageCropArea) => void
    onCancel: () => void
    onSave: () => void
}
