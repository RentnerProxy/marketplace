import { Layers3, ShieldAlert } from 'lucide-react'
import { PERMISSIONS } from '@/config/permissions.config.ts'
import useTranslationStore from '@/language/useTranslationStore.ts'
import type { PermissionChecklistProps } from '../Types/permission-management-component-props.types.ts'

const permissionTranslationKeyByPermissionKey: Record<string, string> = {
    [PERMISSIONS.ADMIN_DASHBOARD]: 'admin.permissions.catalog.adminDashboard',
    [PERMISSIONS.ADMIN_USER_MANAGEMENT]:
        'admin.permissions.catalog.userManagement',
    [PERMISSIONS.ADMIN_ACCOUNT_CONVERSION]:
        'admin.permissions.catalog.accountConversion',
    [PERMISSIONS.ADMIN_SYSTEM_SETTINGS]:
        'admin.permissions.catalog.systemSettings',
    [PERMISSIONS.ADMIN_MAINTENANCE_BYPASS]:
        'admin.permissions.catalog.maintenanceBypass',
    [PERMISSIONS.ADMIN_SUPER_USER]: 'admin.permissions.catalog.superUser',
    [PERMISSIONS.USER_DASHBOARD]: 'admin.permissions.catalog.userDashboard',
    [PERMISSIONS.ADMIN_AUDIT_LOGS]: 'admin.permissions.catalog.auditLogs',
    [PERMISSIONS.ADMIN_BACKUPS]: 'admin.permissions.catalog.backups',
}
const EMPTY_PRESET_PERMISSION_KEYS: Array<string> = []

export default function PermissionChecklist({
    permissions,
    selectedPermissionKeys,
    isLoading,
    disabled = false,
    presetPermissionKeys = EMPTY_PRESET_PERMISSION_KEYS,
    onTogglePermission,
}: PermissionChecklistProps) {
    const { t } = useTranslationStore()

    if (isLoading) {
        return (
            <div className="flex min-h-32 flex-1 items-center justify-center rounded-lg border border-border-dark bg-input-dark/30 px-4 text-center text-sm text-secondary-text">
                {t('admin.permissions.checklist.loading')}
            </div>
        )
    }

    if (permissions.length === 0) {
        return (
            <div className="flex min-h-32 flex-1 items-center justify-center rounded-lg border border-border-dark bg-input-dark/30 px-4 text-center text-sm text-secondary-text">
                {t('admin.permissions.checklist.empty')}
            </div>
        )
    }

    return (
        <div className="flex min-h-32 flex-1 flex-col gap-2 overflow-y-auto pr-1">
            {permissions.map((permission) => {
                const isSuperUserPermission =
                    permission.key === PERMISSIONS.ADMIN_SUPER_USER
                const isPresetPermission = presetPermissionKeys.includes(
                    permission.key,
                )
                const isSelected = selectedPermissionKeys.includes(
                    permission.key,
                )
                const translationKey =
                    permissionTranslationKeyByPermissionKey[permission.key]
                const permissionName = translationKey
                    ? t(`${translationKey}.name`)
                    : permission.name
                const permissionDescription = translationKey
                    ? t(`${translationKey}.description`)
                    : permission.description

                return (
                    <label
                        key={permission.key}
                        className={`flex cursor-pointer items-start gap-3 rounded-lg border border-border-dark p-3 transition-colors hover:bg-input-dark has-disabled:cursor-not-allowed has-disabled:opacity-60 ${
                            isSelected
                                ? 'border-l-2 border-l-primary bg-input-dark'
                                : 'bg-input-dark/30'
                        }`}
                    >
                        <input
                            type="checkbox"
                            checked={isSelected}
                            disabled={disabled}
                            onChange={() => onTogglePermission(permission.key)}
                            className="mt-1 h-4 w-4 shrink-0 accent-primary"
                        />
                        <span className="min-w-0 flex-1">
                            <span className="flex flex-wrap items-center gap-2">
                                <span className="font-medium text-white">
                                    {permissionName}
                                </span>
                                {isSuperUserPermission && (
                                    <span className="inline-flex items-center gap-1 rounded-sm border border-border-dark bg-background-dark px-2 py-0.5 text-xs font-medium text-warning">
                                        <ShieldAlert className="h-3 w-3" />
                                        {t(
                                            'admin.permissions.checklist.superUser',
                                        )}
                                    </span>
                                )}
                                {isPresetPermission && (
                                    <span className="inline-flex items-center gap-1 rounded-sm border border-border-dark bg-background-dark px-2 py-0.5 text-xs font-medium text-foreground">
                                        <Layers3 className="h-3 w-3 text-primary" />
                                        {t(
                                            'admin.permissions.users.presetApplied',
                                        )}
                                    </span>
                                )}
                            </span>
                            <span className="mt-0.5 block text-xs text-secondary-text">
                                {permissionDescription}
                            </span>
                            <span className="mt-1 block break-all font-mono text-[10px] text-secondary-text/60">
                                {permission.key}
                            </span>
                        </span>
                    </label>
                )
            })}
        </div>
    )
}
