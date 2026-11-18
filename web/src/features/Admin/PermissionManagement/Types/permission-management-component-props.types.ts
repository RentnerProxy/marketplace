import type {
    ManagedUserPermissionsHandler,
    ManagedUserPermissionsState,
    PermissionPresetsHandler,
    PermissionPresetsState,
} from './permission-management-logic.types.ts'
import type {
    PermissionManagementPermission,
    PermissionManagementTab,
    PermissionManagementUser,
    PermissionPreset,
} from './permission-management-domain.types.ts'
import type { PermissionPresetFormValues } from './permission-management-form.types.ts'

export type PermissionManagementTabsProps = {
    activeTab: PermissionManagementTab
    onTabChange: (tab: PermissionManagementTab) => void
}

export type PermissionChecklistProps = {
    permissions: Array<PermissionManagementPermission>
    selectedPermissionKeys: Array<string>
    isLoading: boolean
    disabled?: boolean
    presetPermissionKeys?: Array<string>
    onTogglePermission: (permissionKey: string) => void
}

export type PermissionPresetsPanelProps = {
    permissions: Array<PermissionManagementPermission>
    isLoading: boolean
    state: PermissionPresetsState
    handler: PermissionPresetsHandler
}

export type PermissionPresetFormProps = {
    permissions: Array<PermissionManagementPermission>
    isLoading: boolean
    formValues: PermissionPresetFormValues
    isSaving: boolean
    onFieldChange: PermissionPresetsHandler['handleFieldChange']
    onTogglePermission: (permissionKey: string) => void
    onSubmit: () => void
    onCancelEdit: () => void
}

export type PermissionPresetListProps = {
    presets: Array<PermissionPreset>
    onStartCreate: () => void
    onStartEdit: (preset: PermissionPreset) => void
    onAskDelete: (preset: PermissionPreset) => void
}

export type UserPermissionsPanelProps = {
    permissions: Array<PermissionManagementPermission>
    presets: Array<PermissionPreset>
    state: ManagedUserPermissionsState
    handler: ManagedUserPermissionsHandler
}

export type ManagedUsersListProps = Pick<
    UserPermissionsPanelProps,
    'state' | 'handler'
>

export type ManagedUserPermissionEditorProps = {
    permissions: Array<PermissionManagementPermission>
    presets: Array<PermissionPreset>
    selectedUser: PermissionManagementUser | null
    permissionKeys: Array<string>
    appliedPresets: Array<PermissionPreset>
    presetPermissionKeys: Array<string>
    selectedPresetId: string
    isDirty: boolean
    isSaving: boolean
    onTogglePermission: (permissionKey: string) => void
    onSelectPreset: (presetId: string) => void
    onSave: () => void
}
