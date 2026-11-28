import { Layers3, ShieldAlert } from 'lucide-react'
import { PERMISSIONS } from '@/config/permissions.config.ts'
import useTranslationStore from '@/language/useTranslationStore.ts'
import type { TranslationKey } from '@/language/translation.ts'
import type { PermissionChecklistProps } from '../Types/permission-management-component-props.types.ts'

type PermissionCatalogEntry<Key = TranslationKey> =
    Key extends `admin.permissions.catalog.${infer Entry}.name` ? Entry : never

const permissionCatalogEntries = new Map<string, PermissionCatalogEntry>([
    [PERMISSIONS.ADMIN_DASHBOARD, 'adminDashboard'],
    [PERMISSIONS.ADMIN_USER_MANAGEMENT, 'userManagement'],
    [PERMISSIONS.ADMIN_ACCOUNT_CONVERSION, 'accountConversion'],
    [PERMISSIONS.ADMIN_SYSTEM_SETTINGS, 'systemSettings'],
    [PERMISSIONS.ADMIN_MAINTENANCE_BYPASS, 'maintenanceBypass'],
    [PERMISSIONS.ADMIN_SUPER_USER, 'superUser'],
    [PERMISSIONS.USER_DASHBOARD, 'userDashboard'],
    [PERMISSIONS.ADMIN_AUDIT_LOGS, 'auditLogs'],
    [PERMISSIONS.ADMIN_BACKUPS, 'backups'],
])
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
                const catalogEntry = permissionCatalogEntries.get(
                    permission.key,
                )
                const permissionName = catalogEntry
                    ? t(`admin.permissions.catalog.${catalogEntry}.name`)
                    : permission.name
                const permissionDescription = catalogEntry
                    ? t(`admin.permissions.catalog.${catalogEntry}.description`)
                    : permission.description

                return (
                    <label
                        key={permission.key}
                        className={`flex cursor-pointer items-start gap-3 rounded-md border-2 p-3 transition-colors hover:bg-input-dark has-disabled:cursor-not-allowed has-disabled:opacity-60 ${
                            isSelected
                                ? 'border-primary bg-input-dark shadow-[3px_3px_0_0_var(--color-primary)]'
                                : 'border-border-dark bg-input-dark/30'
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
