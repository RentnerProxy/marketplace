import type { SerializedSingleCalendarValue } from '@rentnerkev/calendar'
import type { ImageCropPosition } from '@/shared/Types/image-crop.types.ts'
import type {
    UserThemeMode,
    UserFontFamily,
} from '@/lib/Theme/Types/userTheme.types.ts'
import type {
    PermissionPreset,
    PermissionManagementTab,
} from '@/features/Admin/PermissionManagement/Types/permission-management-domain.types.ts'
import type useSystemColorLogic from '@/features/UserSettings/Components/AppearanceSection/Hooks/useSystemColorLogic.ts'
import type useMainThemeLogic from '@/features/UserSettings/Components/AppearanceSection/Hooks/useMainThemeLogic.ts'
import type useFontsLogic from '@/features/UserSettings/Components/AppearanceSection/Hooks/useFontsLogic.ts'
import type useNotificationsLogic from '@/features/Notifications/Hooks/useNotificationsLogic.ts'
import type useProfileImageSettingsLogic from '@/features/UserSettings/Components/Account/Hooks/useProfileImageSettingsLogic.ts'
import type usePersonalInfoSettingsLogic from '@/features/UserSettings/Components/Account/Hooks/usePersonalInfoSettingsLogic.ts'
import type useMaintenanceBannerLogic from '@/layouts/AuthenticatedLayout/Hooks/useMaintenanceBannerLogic.ts'
import type usePermissionPresets from '@/features/Admin/PermissionManagement/Hooks/usePermissionPresets.ts'
import type usePermissionManagementLogic from '@/features/Admin/PermissionManagement/Hooks/usePermissionManagementLogic.ts'
import type useSystemLogoUpload from '@/features/Admin/SystemSettings/Hooks/useSystemLogoUpload.ts'
import type useMaintenanceSettings from '@/features/Admin/SystemSettings/Hooks/useMaintenanceSettings.ts'
import type useCompanyNameForm from '@/features/Admin/SystemSettings/Hooks/useCompanyNameForm.ts'

type IsValueHandler<THandler, TValue> = [THandler] extends [
    (value: TValue) => void,
]
    ? [(value: TValue) => void] extends [THandler]
        ? true
        : false
    : false

type AssertAll<T extends Record<keyof T, true>> = T

export type SetterHandlerContracts = AssertAll<{
    useSystemColorLogic_handlePrimaryColorChange: IsValueHandler<
        ReturnType<
            typeof useSystemColorLogic
        >['handler']['handlePrimaryColorChange'],
        string
    >
    useSystemColorLogic_handlePrimaryColorValidityChange: IsValueHandler<
        ReturnType<
            typeof useSystemColorLogic
        >['handler']['handlePrimaryColorValidityChange'],
        boolean
    >
    useMainThemeLogic_handleThemeModeChange: IsValueHandler<
        ReturnType<
            typeof useMainThemeLogic
        >['handler']['handleThemeModeChange'],
        UserThemeMode
    >
    useFontsLogic_handleFontFamilyChange: IsValueHandler<
        ReturnType<typeof useFontsLogic>['handler']['handleFontFamilyChange'],
        UserFontFamily
    >
    useNotificationsLogic_handleTabChange: IsValueHandler<
        ReturnType<typeof useNotificationsLogic>['handler']['handleTabChange'],
        'unread' | 'read'
    >
    useProfileImageSettingsLogic_handleCropChange: IsValueHandler<
        ReturnType<
            typeof useProfileImageSettingsLogic
        >['handler']['handleCropChange'],
        ImageCropPosition
    >
    useProfileImageSettingsLogic_handleZoomChange: IsValueHandler<
        ReturnType<
            typeof useProfileImageSettingsLogic
        >['handler']['handleZoomChange'],
        number
    >
    usePersonalInfoSettingsLogic_handleFirstNameChange: IsValueHandler<
        ReturnType<
            typeof usePersonalInfoSettingsLogic
        >['handler']['handleFirstNameChange'],
        string
    >
    usePersonalInfoSettingsLogic_handleLastNameChange: IsValueHandler<
        ReturnType<
            typeof usePersonalInfoSettingsLogic
        >['handler']['handleLastNameChange'],
        string
    >
    usePersonalInfoSettingsLogic_handleStreetChange: IsValueHandler<
        ReturnType<
            typeof usePersonalInfoSettingsLogic
        >['handler']['handleStreetChange'],
        string
    >
    usePersonalInfoSettingsLogic_handleHouseNumberChange: IsValueHandler<
        ReturnType<
            typeof usePersonalInfoSettingsLogic
        >['handler']['handleHouseNumberChange'],
        string
    >
    usePersonalInfoSettingsLogic_handlePostalCodeChange: IsValueHandler<
        ReturnType<
            typeof usePersonalInfoSettingsLogic
        >['handler']['handlePostalCodeChange'],
        string
    >
    usePersonalInfoSettingsLogic_handleCityChange: IsValueHandler<
        ReturnType<
            typeof usePersonalInfoSettingsLogic
        >['handler']['handleCityChange'],
        string
    >
    useMaintenanceBannerLogic_handleReasonChange: IsValueHandler<
        ReturnType<
            typeof useMaintenanceBannerLogic
        >['handler']['handleReasonChange'],
        string
    >
    usePermissionPresets_handleAskDelete: IsValueHandler<
        ReturnType<typeof usePermissionPresets>['handler']['handleAskDelete'],
        PermissionPreset
    >
    usePermissionManagementLogic_handleTabChange: IsValueHandler<
        ReturnType<
            typeof usePermissionManagementLogic
        >['handler']['handleTabChange'],
        PermissionManagementTab
    >
    useSystemLogoUpload_handleCropChange: IsValueHandler<
        ReturnType<typeof useSystemLogoUpload>['handler']['handleCropChange'],
        ImageCropPosition
    >
    useSystemLogoUpload_handleZoomChange: IsValueHandler<
        ReturnType<typeof useSystemLogoUpload>['handler']['handleZoomChange'],
        number
    >
    useMaintenanceSettings_handleMaintenanceStartsAtChange: IsValueHandler<
        ReturnType<
            typeof useMaintenanceSettings
        >['handler']['handleMaintenanceStartsAtChange'],
        SerializedSingleCalendarValue
    >
    useMaintenanceSettings_handleMaintenanceExtensionMinutesChange: IsValueHandler<
        ReturnType<
            typeof useMaintenanceSettings
        >['handler']['handleMaintenanceExtensionMinutesChange'],
        number | null
    >
    useCompanyNameForm_handleCompanyNameChange: IsValueHandler<
        ReturnType<
            typeof useCompanyNameForm
        >['handler']['handleCompanyNameChange'],
        string
    >
}>
