import type { SerializedSingleCalendarValue } from '@rentnerkev/calendar'
import type {
    ImageCropArea,
    ImageCropPosition,
} from '@/shared/Types/image-crop.types.ts'

export type SystemSettingsState = {
    companyName: string
    logoPreviewSrc: string
    selectedLogoDataUrl: string | null
    crop: ImageCropPosition
    zoom: number
    isPublicRegistrationEnabled: boolean
    isPublicRegistrationSwitchDisabled: boolean
    isMaintenanceModeEnabled: boolean
    isMaintenanceModeActive: boolean
    maintenanceMinDateTime: Date
    maintenanceStartsAt: SerializedSingleCalendarValue
    pendingMaintenanceExtensionRequest: PendingMaintenanceExtensionRequest | null
    maintenanceExtensionMinutes: number | null
    maintenanceExtensionMinutesError: string | null
    isSavingCompanyName: boolean
    isSavingLogo: boolean
    isSavingMaintenanceMode: boolean
    isResolvingMaintenanceExtensionRequest: boolean
}

export type SystemSettingsHandler = {
    handleCompanyNameChange: (value: string) => void
    handleSaveCompanyName: () => void
    handleSelectLogo: (file: File | null) => void
    handleCropChange: (crop: ImageCropPosition) => void
    handleZoomChange: (zoom: number) => void
    handleCropComplete: (_: unknown, croppedAreaPixels: ImageCropArea) => void
    handleSaveLogo: () => void
    handleResetSelectedLogo: () => void
    handlePublicRegistrationChange: (isEnabled: boolean) => void
    handleMaintenanceStartsAtChange: (
        value: SerializedSingleCalendarValue,
    ) => void
    handleMaintenanceExtensionMinutesChange: (value: number | null) => void
    handleEnableMaintenanceMode: () => void
    handleDisableMaintenanceMode: () => void
    handleApproveMaintenanceExtensionRequest: () => void
    handleRejectMaintenanceExtensionRequest: () => void
}

export type PendingMaintenanceExtensionRequest = {
    id: string
    reason: string
    requestedAt: string
    user: {
        id: string
        username: string
    }
}

export type SystemSettingsLogicReturn = {
    state: SystemSettingsState
    handler: SystemSettingsHandler
}
