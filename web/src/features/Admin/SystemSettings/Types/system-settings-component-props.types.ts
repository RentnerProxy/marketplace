import type { SystemSettingsHandler, SystemSettingsState } from './types.ts'

export type CompanyNameSectionProps = {
    state: Pick<SystemSettingsState, 'companyName' | 'isSavingCompanyName'>
    handler: Pick<
        SystemSettingsHandler,
        'handleCompanyNameChange' | 'handleSaveCompanyName'
    >
}

export type CompanyLogoSectionProps = {
    state: Pick<
        SystemSettingsState,
        | 'logoPreviewSrc'
        | 'selectedLogoDataUrl'
        | 'crop'
        | 'zoom'
        | 'isSavingLogo'
    >
    handler: Pick<
        SystemSettingsHandler,
        | 'handleSelectLogo'
        | 'handleCropChange'
        | 'handleZoomChange'
        | 'handleCropComplete'
        | 'handleSaveLogo'
        | 'handleResetSelectedLogo'
    >
}

export type MaintenanceSectionProps = {
    state: Pick<
        SystemSettingsState,
        | 'isMaintenanceModeEnabled'
        | 'isMaintenanceModeActive'
        | 'maintenanceMinDateTime'
        | 'maintenanceStartsAt'
        | 'pendingMaintenanceExtensionRequest'
        | 'maintenanceExtensionMinutes'
        | 'maintenanceExtensionMinutesError'
        | 'isSavingMaintenanceMode'
        | 'isResolvingMaintenanceExtensionRequest'
    >
    handler: Pick<
        SystemSettingsHandler,
        | 'handleMaintenanceStartsAtChange'
        | 'handleMaintenanceExtensionMinutesChange'
        | 'handleEnableMaintenanceMode'
        | 'handleDisableMaintenanceMode'
        | 'handleApproveMaintenanceExtensionRequest'
        | 'handleRejectMaintenanceExtensionRequest'
    >
}
