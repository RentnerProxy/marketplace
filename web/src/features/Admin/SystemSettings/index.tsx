import CompanyNameSection from './Components/CompanyNameSection.tsx'
import CompanyLogoSection from './Components/CompanyLogoSection.tsx'
import MaintenanceSection from './Components/MaintenanceSection.tsx'
import PublicRegistrationSection from './Components/PublicRegistrationSection.tsx'
import useSystemSettingsLogic from './Hooks/useSystemSettingsLogic.ts'

export default function SystemSettings() {
    const { state, handler } = useSystemSettingsLogic()

    return (
        <div className="@container/settings">
            <div className="grid gap-5 @5xl/settings:grid-cols-[minmax(0,1.45fr)_minmax(22.5rem,0.85fr)]">
                <CompanyLogoSection
                    state={{
                        logoPreviewSrc: state.logoPreviewSrc,
                        selectedLogoDataUrl: state.selectedLogoDataUrl,
                        crop: state.crop,
                        zoom: state.zoom,
                        isSavingLogo: state.isSavingLogo,
                    }}
                    handler={{
                        handleSelectLogo: handler.handleSelectLogo,
                        handleCropChange: handler.handleCropChange,
                        handleZoomChange: handler.handleZoomChange,
                        handleCropComplete: handler.handleCropComplete,
                        handleSaveLogo: handler.handleSaveLogo,
                        handleResetSelectedLogo:
                            handler.handleResetSelectedLogo,
                    }}
                />
                <div className="flex min-w-0 flex-col gap-5">
                    <CompanyNameSection
                        state={{
                            companyName: state.companyName,
                            isSavingCompanyName: state.isSavingCompanyName,
                        }}
                        handler={{
                            handleCompanyNameChange:
                                handler.handleCompanyNameChange,
                            handleSaveCompanyName:
                                handler.handleSaveCompanyName,
                        }}
                    />
                    <PublicRegistrationSection
                        enabled={state.isPublicRegistrationEnabled}
                        disabled={state.isPublicRegistrationSwitchDisabled}
                        onChange={handler.handlePublicRegistrationChange}
                    />
                    <MaintenanceSection
                        state={{
                            isMaintenanceModeEnabled:
                                state.isMaintenanceModeEnabled,
                            isMaintenanceModeActive:
                                state.isMaintenanceModeActive,
                            maintenanceMinDateTime:
                                state.maintenanceMinDateTime,
                            maintenanceStartsAt: state.maintenanceStartsAt,
                            pendingMaintenanceExtensionRequest:
                                state.pendingMaintenanceExtensionRequest,
                            maintenanceExtensionMinutes:
                                state.maintenanceExtensionMinutes,
                            maintenanceExtensionMinutesError:
                                state.maintenanceExtensionMinutesError,
                            isSavingMaintenanceMode:
                                state.isSavingMaintenanceMode,
                            isResolvingMaintenanceExtensionRequest:
                                state.isResolvingMaintenanceExtensionRequest,
                        }}
                        handler={{
                            handleMaintenanceStartsAtChange:
                                handler.handleMaintenanceStartsAtChange,
                            handleMaintenanceExtensionMinutesChange:
                                handler.handleMaintenanceExtensionMinutesChange,
                            handleEnableMaintenanceMode:
                                handler.handleEnableMaintenanceMode,
                            handleDisableMaintenanceMode:
                                handler.handleDisableMaintenanceMode,
                            handleApproveMaintenanceExtensionRequest:
                                handler.handleApproveMaintenanceExtensionRequest,
                            handleRejectMaintenanceExtensionRequest:
                                handler.handleRejectMaintenanceExtensionRequest,
                        }}
                    />
                </div>
            </div>
        </div>
    )
}
