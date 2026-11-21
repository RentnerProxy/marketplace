import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from '@rentnerkev/toasts'
import {
    ADMIN_SYSTEM_SETTINGS_QUERY_KEY,
    SYSTEM_SETTINGS_QUERY_KEY,
} from '@/lib/Queries/appQueries.ts'
import useTranslationStore from '@/language/useTranslationStore.ts'
import {
    getAdminSystemSettingsHandler,
    updatePublicRegistrationHandler,
} from '../middleware.ts'
import type { SystemSettingsLogicReturn } from '../Types/types.ts'
import useCompanyNameForm from './useCompanyNameForm.ts'
import useMaintenanceSettings from './useMaintenanceSettings.ts'
import useSystemLogoUpload from './useSystemLogoUpload.ts'

export default function useSystemSettingsLogic(): SystemSettingsLogicReturn {
    const { t } = useTranslationStore()
    const queryClient = useQueryClient()
    const settingsQuery = useQuery({
        queryKey: ADMIN_SYSTEM_SETTINGS_QUERY_KEY,
        queryFn: getAdminSystemSettingsHandler,
    })
    const publicRegistration = useMutation({
        mutationFn: (isEnabled: boolean) =>
            updatePublicRegistrationHandler({ data: { isEnabled } }),
        onSuccess: async () => {
            await queryClient.invalidateQueries({
                queryKey: SYSTEM_SETTINGS_QUERY_KEY,
            })
            toast.success(t('admin.systemSettings.publicRegistrationSaved'), {
                title: t('admin.systemSettings.title'),
            })
        },
        onError: () => {
            toast.error(t('admin.systemSettings.publicRegistrationSaveError'), {
                title: t('common.error'),
            })
        },
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
            isPublicRegistrationEnabled:
                settingsQuery.data?.isPublicRegistrationEnabled ?? false,
            isPublicRegistrationSwitchDisabled:
                !settingsQuery.data || publicRegistration.isPending,
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
            handlePublicRegistrationChange: publicRegistration.mutate,
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
