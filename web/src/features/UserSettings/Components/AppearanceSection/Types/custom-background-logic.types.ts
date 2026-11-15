import type {
    ImageCropArea,
    ImageCropSize,
} from '@/shared/Types/image-crop.types.ts'
import type useCustomBackgroundSelection from '../Hooks/useCustomBackgroundSelection.ts'
import type useCustomBackgroundAppearanceMutation from '../Hooks/useCustomBackgroundAppearanceMutation.ts'
import type useCustomBackgroundImageMutations from '../Hooks/useCustomBackgroundImageMutations.ts'
import type useCustomBackgroundPreviewLayout from '../Hooks/useCustomBackgroundPreviewLayout.ts'

type BackgroundSelection = ReturnType<typeof useCustomBackgroundSelection>
type BackgroundAppearance = ReturnType<
    typeof useCustomBackgroundAppearanceMutation
>
type BackgroundMutations = ReturnType<typeof useCustomBackgroundImageMutations>

export type CustomBackgroundLogicReturn = {
    refs: BackgroundSelection['refs']
    handler: BackgroundSelection['handler'] &
        BackgroundAppearance['handler'] &
        BackgroundMutations['handler']
    state: BackgroundSelection['state'] &
        BackgroundAppearance['state'] &
        BackgroundMutations['state'] & {
            customBackgroundSrc: string | null
            hasCustomBackground: boolean
            previewLayout: ReturnType<
                typeof useCustomBackgroundPreviewLayout
            >['state']
        }
}

export type CustomBackgroundPreviewViewport = ImageCropSize & {
    rem: number
}

export type CustomBackgroundImageMutationsOptions = {
    backgroundCroppedAreaPixels: ImageCropArea | null
    backgroundImageSrc: string | null
    customBackgroundDarknessValue: number
    resetSelectedBackgroundImage: () => void
}
