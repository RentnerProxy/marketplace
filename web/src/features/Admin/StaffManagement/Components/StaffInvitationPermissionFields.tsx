import { CustomSelect } from '@rentnerkev/select'
import PermissionChecklist from '@/features/Admin/PermissionManagement/Components/PermissionChecklist.tsx'
import useTranslationStore from '@/language/useTranslationStore.ts'
import type { StaffInvitationPermissionFieldsProps } from '../Types/staff-invitations-logic.types.ts'

export default function StaffInvitationPermissionFields({
    selection,
    disabled,
}: StaffInvitationPermissionFieldsProps) {
    const { t } = useTranslationStore()
    const { state, handler } = selection

    return (
        <div className="space-y-3">
            {state.isLoadError && (
                <div
                    role="alert"
                    className="flex flex-wrap items-center gap-3 text-sm"
                >
                    <p className="text-secondary-text">
                        {t('admin.staff.permissionsLoadError')}
                    </p>
                    <button
                        type="button"
                        onClick={handler.handleRetry}
                        className="rounded-md border border-border-dark px-3 py-2"
                    >
                        {t('admin.permissions.retry')}
                    </button>
                </div>
            )}
            {state.presetOptions.length > 0 && (
                <CustomSelect
                    label={t('admin.permissions.users.presetLabel')}
                    value={state.presetId}
                    onValueChange={handler.handleSelectPreset}
                    options={state.presetOptions}
                    placeholder={t('admin.permissions.users.presetPlaceholder')}
                    disabled={disabled}
                />
            )}
            <PermissionChecklist
                permissions={state.permissions}
                selectedPermissionKeys={state.permissionKeys}
                isLoading={state.isLoadingPermissions}
                disabled={disabled}
                onTogglePermission={handler.handleTogglePermission}
            />
        </div>
    )
}
