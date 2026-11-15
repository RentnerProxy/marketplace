import type useCustomBackgroundLogic from '../Hooks/useCustomBackgroundLogic.ts'

type CustomBackgroundLogic = ReturnType<typeof useCustomBackgroundLogic>

export type CustomBackgroundPreviewProps = {
    containerRef: CustomBackgroundLogic['refs']['containerRef']
    handler: Pick<
        CustomBackgroundLogic['handler'],
        | 'handleBackgroundCropChange'
        | 'handleBackgroundCropComplete'
        | 'handleBackgroundZoomChange'
    >
    state: Pick<
        CustomBackgroundLogic['state'],
        | 'backgroundCrop'
        | 'backgroundImageSrc'
        | 'backgroundZoom'
        | 'cropSize'
        | 'customBackgroundDarknessValue'
        | 'previewBackgroundSrc'
        | 'previewLayout'
    >
}

export type CustomBackgroundControlsProps = {
    handler: Pick<
        CustomBackgroundLogic['handler'],
        | 'handleBackgroundDarknessChange'
        | 'handleBackgroundZoomChange'
        | 'handleDeleteBackgroundImage'
        | 'handleResetSelectedBackgroundImage'
        | 'handleSaveBackgroundAppearance'
        | 'handleSaveBackgroundImage'
    >
    state: Pick<
        CustomBackgroundLogic['state'],
        | 'backgroundCroppedAreaPixels'
        | 'backgroundImageSrc'
        | 'backgroundZoom'
        | 'customBackgroundDarknessValue'
        | 'customBackgroundSrc'
        | 'hasCustomBackground'
        | 'isDeletingBackgroundImage'
        | 'isSavingBackgroundAppearance'
        | 'isSavingBackgroundImage'
    >
}
