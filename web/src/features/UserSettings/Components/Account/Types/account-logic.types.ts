import type { ImageCropSelection } from '@/shared/Images/Types/image-crop-selection.types.ts'

export type ProfileImageSettingsLogicReturn = {
    state: Pick<ImageCropSelection['state'], 'crop' | 'imageSrc' | 'zoom'> & {
        copy: boolean
        isSavingProfileImage: boolean
    }
    handler: Pick<
        ImageCropSelection['handler'],
        'handleCropComplete' | 'handleSelectImage'
    > & {
        handleCopy: () => Promise<void>
        handleCropChange: (crop: ImageCropSelection['state']['crop']) => void
        handleZoomChange: (zoom: number) => void
        handleResetSelectedImage: () => void
        handleSaveProfileImage: () => void
    }
}
