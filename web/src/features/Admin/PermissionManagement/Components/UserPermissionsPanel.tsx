import ManagedUserPermissionEditor from './ManagedUserPermissionEditor.tsx'
import ManagedUsersList from './ManagedUsersList.tsx'
import type { UserPermissionsPanelProps } from '../Types/permission-management-component-props.types.ts'

export default function UserPermissionsPanel({
    permissions,
    presets,
    state,
    handler,
}: UserPermissionsPanelProps) {
    return (
        <div className="grid gap-4 xl:grid-cols-[minmax(320px,0.72fr)_minmax(0,1.28fr)] xl:gap-6">
            <ManagedUsersList state={state} handler={handler} />
            <ManagedUserPermissionEditor
                permissions={permissions}
                presets={presets}
                selectedUser={state.selectedUser}
                permissionKeys={state.permissionKeys}
                appliedPresets={state.appliedPresets}
                presetPermissionKeys={state.presetPermissionKeys}
                selectedPresetId={state.selectedPresetId}
                isDirty={state.isDirty}
                isSaving={state.isSaving}
                onTogglePermission={handler.handleTogglePermission}
                onSelectPreset={handler.handleSelectPreset}
                onSave={handler.handleSave}
            />
        </div>
    )
}
