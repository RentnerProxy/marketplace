import { useQuery } from '@tanstack/react-query'
import { ADMIN_SYSTEM_SETTINGS_QUERY_KEY } from '@/lib/Queries/appQueries.ts'
import { getAdminSystemSettingsHandler } from '../middleware.ts'
import type { SystemSettingsLogicReturn } from '../Types/types.ts'
import useCompanyNameForm from './useCompanyNameForm.ts'
import useMaintenanceSettings from './useMaintenanceSettings.ts'
import useSystemLogoUpload from './useSystemLogoUpload.ts'

export default function useSystemSettingsLogic(): SystemSettingsLogicReturn {
    const settingsQuery = useQuery({
        queryKey: ADMIN_SYSTEM_SETTINGS_QUERY_KEY,
        queryFn: getAdminSystemSettingsHandler,
    })
    const companyNameForm = useCompanyNameForm(settingsQuery.data?.companyName)
    const systemLogoUpload = useSystemLogoUpload()
    const maintenanceSettings = useMaintenanceSettings({
        currentMaintenanceStartsAt: settingsQuery.data?.maintenanceStartsAt,
        pendingMaintenanceExtensionRequest:
            settingsQuery.data?.pendingMaintenanceExtensionRequest,
    })

    return {
        state: {
            companyName: companyNameForm.state.companyName,
            isSavingCompanyName: companyNameForm.state.isSavingCompanyName,
            logoPreviewSrc: settingsQuery.data?.logoSrc ?? '/favicon.ico',
            selectedLogoDataUrl: systemLogoUpload.state.selectedLogoDataUrl,
            crop: systemLogoUpload.state.crop,
            zoom: systemLogoUpload.state.zoom,
            isSavingLogo: systemLogoUpload.state.isSavingLogo,
            isMaintenanceModeEnabled:
                settingsQuery.data?.isMaintenanceModeEnabled ?? false,
            isMaintenanceModeActive:
                settingsQuery.data?.isMaintenanceModeActive ?? false,
            maintenanceMinDateTime:
                maintenanceSettings.state.maintenanceMinDateTime,
            maintenanceStartsAt: maintenanceSettings.state.maintenanceStartsAt,
            maintenanceExtensionMinutes:
                maintenanceSettings.state.maintenanceExtensionMinutes,
            maintenanceExtensionMinutesError:
                maintenanceSettings.state.maintenanceExtensionMinutesError,
            isSavingMaintenanceMode:
                maintenanceSettings.state.isSavingMaintenanceMode,
            isResolvingMaintenanceExtensionRequest:
                maintenanceSettings.state
                    .isResolvingMaintenanceExtensionRequest,
            pendingMaintenanceExtensionRequest:
                settingsQuery.data?.pendingMaintenanceExtensionRequest ?? null,
        },
        handler: {
            handleCompanyNameChange:
                companyNameForm.handler.handleCompanyNameChange,
            handleSaveCompanyName:
                companyNameForm.handler.handleSaveCompanyName,
            handleSelectLogo: systemLogoUpload.handler.handleSelectLogo,
            handleCropChange: systemLogoUpload.handler.handleCropChange,
            handleZoomChange: systemLogoUpload.handler.handleZoomChange,
            handleCropComplete: systemLogoUpload.handler.handleCropComplete,
            handleSaveLogo: systemLogoUpload.handler.handleSaveLogo,
            handleResetSelectedLogo:
                systemLogoUpload.handler.handleResetSelectedLogo,
            handleMaintenanceStartsAtChange:
                maintenanceSettings.handler.handleMaintenanceStartsAtChange,
            handleMaintenanceExtensionMinutesChange:
                maintenanceSettings.handler
                    .handleMaintenanceExtensionMinutesChange,
            handleEnableMaintenanceMode:
                maintenanceSettings.handler.handleEnableMaintenanceMode,
            handleDisableMaintenanceMode:
                maintenanceSettings.handler.handleDisableMaintenanceMode,
            handleApproveMaintenanceExtensionRequest:
                maintenanceSettings.handler
                    .handleApproveMaintenanceExtensionRequest,
            handleRejectMaintenanceExtensionRequest:
                maintenanceSettings.handler
                    .handleRejectMaintenanceExtensionRequest,
        },
    }
}
