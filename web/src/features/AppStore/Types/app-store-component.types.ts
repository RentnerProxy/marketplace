import type {
    ImageCropArea,
    ImageCropPosition,
} from '@/shared/Types/image-crop.types.ts'
import type {
    AppDetail,
    EditableStoreApp,
    StoreEntryEditor,
    StoreScreenshot,
} from './app-store.types.ts'

type CropHandlers = {
    handleSelectImage: (file: File | null) => void
    handleCropComplete: (_: unknown, pixels: ImageCropArea) => void
    handleCropChange: (crop: ImageCropPosition) => void
    handleZoomChange: (zoom: number) => void
}

type CropState = {
    imageSrc: string | null
    crop: ImageCropPosition
    zoom: number
}

export type StoreEditorPageProps = { appId: string }

export type StoreEditorPageLogicReturn = {
    state: { entry: StoreEntryEditor | null; isLoading: boolean }
}

export type StoreLogoEditorProps = {
    appId: string
    logoSrc: string | null
    name: string
}

export type StoreLogoLogicReturn = {
    state: CropState & {
        isSavingLogo: boolean
        isRemoveDialogOpen: boolean
        isRemovingLogo: boolean
    }
    handler: CropHandlers & {
        handleCancelLogo: () => void
        handleSaveLogo: () => void
        handleOpenRemoveLogo: () => void
        handleCloseRemoveLogo: () => void
        handleConfirmRemoveLogo: () => void
    }
}

export type StoreScreenshotsEditorProps = {
    appId: string
    screenshots: Array<StoreScreenshot>
}

export type StoreScreenshotsLogicReturn = {
    state: CropState & {
        canAdd: boolean
        isSavingScreenshot: boolean
        isReordering: boolean
        removeId: string | null
        isRemovingScreenshot: boolean
    }
    handler: CropHandlers & {
        handleCancelScreenshot: () => void
        handleSaveScreenshot: () => void
        handleMove: (index: number, offset: -1 | 1) => void
        handleOpenRemove: (screenshotId: string) => void
        handleCloseRemove: () => void
        handleConfirmRemove: () => void
    }
}

export type StoreDescriptionEditorProps = {
    appId: string
    description: string
}

export type StoreDescriptionLogicReturn = {
    state: { value: string; hasChanged: boolean; isSaving: boolean }
    handler: {
        handleChange: (value: string) => void
        handleReset: () => void
        handleSave: () => void
    }
}

export type AppLogoProps = {
    logoSrc: string | null
    name: string
    size: 'sm' | 'md' | 'lg'
}

export type EditableStoreAppsLogicReturn = {
    state: { apps: Array<EditableStoreApp>; isLoading: boolean }
}

export type AppDetailPageProps = { appId: string }

export type AppDetailPageLogicReturn = {
    state: { app: AppDetail | null; isSignedIn: boolean }
}

export type ScreenshotGalleryProps = {
    name: string
    screenshots: Array<StoreScreenshot>
}

export type ScreenshotGalleryLogicReturn = {
    state: { activeIndex: number; isLightboxOpen: boolean }
    handler: {
        handleSelect: (index: number) => void
        handlePrevious: () => void
        handleNext: () => void
        handleOpenLightbox: () => void
        handleCloseLightbox: () => void
    }
}
