import type {
    PermissionManagementPermission,
    PermissionManagementTab,
    PermissionManagementUser,
    PermissionPreset,
} from './permission-management-domain.types.ts'
import type { PermissionPresetFormValues } from './permission-management-form.types.ts'

export type DefaultPermissionsState = {
    permissionKeys: Array<string>
    isDirty: boolean
    isSaving: boolean
}

export type DefaultPermissionsHandler = {
    handleTogglePermission: (permissionKey: string) => void
    handleSave: () => void
}

export type PermissionPresetsState = {
    formValues: PermissionPresetFormValues
    presets: Array<PermissionPreset>
    deleteTarget: PermissionPreset | null
    isSaving: boolean
    isDeleting: boolean
}

export type PermissionPresetsHandler = {
    handleFieldChange: <TKey extends keyof PermissionPresetFormValues>(
        key: TKey,
        value: PermissionPresetFormValues[TKey],
    ) => void
    handleTogglePermission: (permissionKey: string) => void
    handleSubmit: () => void
    handleStartCreate: () => void
    handleStartEdit: (preset: PermissionPreset) => void
    handleAskDelete: (preset: PermissionPreset) => void
    handleCloseDeleteModal: () => void
    handleConfirmDelete: () => void
}

export type ManagedUserPermissionsState = {
    users: Array<PermissionManagementUser>
    total: number
    searchInput: string
    pageIndex: number
    pageCount: number
    canGoPrevious: boolean
    canGoNext: boolean
    isLoading: boolean
    isError: boolean
    selectedUser: PermissionManagementUser | null
    permissionKeys: Array<string>
    appliedPresets: Array<PermissionPreset>
    presetPermissionKeys: Array<string>
    selectedPresetId: string
    isDirty: boolean
    isSaving: boolean
}

export type ManagedUserPermissionsHandler = {
    handleSearchInputChange: (value: string) => void
    handlePreviousPage: () => void
    handleNextPage: () => void
    handleSelectUser: (user: PermissionManagementUser) => void
    handleTogglePermission: (permissionKey: string) => void
    handleSelectPreset: (presetId: string) => void
    handleSave: () => void
    handleRetry: () => void
}

type PermissionManagementState = {
    activeTab: PermissionManagementTab
    permissions: Array<PermissionManagementPermission>
    assignablePermissions: Array<PermissionManagementPermission>
    presets: Array<PermissionPreset>
    isLoadingOverview: boolean
    isOverviewError: boolean
    defaults: DefaultPermissionsState
    permissionPresets: PermissionPresetsState
    managedUsers: ManagedUserPermissionsState
}

type PermissionManagementHandler = {
    handleTabChange: (tab: PermissionManagementTab) => void
    handleRetryOverview: () => void
    defaults: DefaultPermissionsHandler
    permissionPresets: PermissionPresetsHandler
    managedUsers: ManagedUserPermissionsHandler
}

export type PermissionManagementLogicReturn = {
    state: PermissionManagementState
    handler: PermissionManagementHandler
}

export type UsePermissionPresetsParams = {
    presets: Array<PermissionPreset>
}

export type UseManagedUserPermissionsParams = {
    enabled: boolean
    presets: Array<PermissionPreset>
}

export type UseDefaultPermissionsParams = {
    defaultPermissionKeys: Array<string>
}
