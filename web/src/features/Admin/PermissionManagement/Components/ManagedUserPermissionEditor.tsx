import { Layers3, Save, ShieldCheck, UserRound } from 'lucide-react'
import { CustomSelect } from '@rentnerkev/select'
import useTranslationStore from '@/language/useTranslationStore.ts'
import StatusIndicator from '@/shared/StatusIndicator.tsx'
import HeadingIcon from '@/shared/HeadingIcon.tsx'
import PermissionChecklist from './PermissionChecklist.tsx'
import type { ManagedUserPermissionEditorProps } from '../Types/permission-management-component-props.types.ts'

export default function ManagedUserPermissionEditor({
    permissions,
    presets,
    selectedUser,
    permissionKeys,
    appliedPresets,
    presetPermissionKeys,
    selectedPresetId,
    isDirty,
    isSaving,
    onTogglePermission,
    onSelectPreset,
    onSave,
}: ManagedUserPermissionEditorProps) {
    const { t } = useTranslationStore()

    if (!selectedUser) {
        return (
            <section className="flex h-full min-h-0 items-center justify-center rounded-lg border border-border-dark bg-surface-dark p-6 text-center">
                <div className="max-w-sm">
                    <HeadingIcon
                        icon={UserRound}
                        size="lg"
                        className="mx-auto"
                    />
                    <h2 className="mt-4 text-lg font-bold text-white">
                        {t('admin.permissions.users.noSelectionTitle')}
                    </h2>
                    <p className="mt-2 text-sm text-secondary-text">
                        {t('admin.permissions.users.noSelectionDescription')}
                    </p>
                </div>
            </section>
        )
    }

    return (
        <section className="flex h-full min-h-0 flex-col overflow-hidden rounded-lg border border-border-dark bg-surface-dark p-5">
            <div className="flex min-h-0 flex-1 flex-col overflow-y-auto pr-1">
                <div className="mb-5 flex shrink-0 flex-col gap-3 border-b border-border-dark pb-5 sm:flex-row sm:items-start sm:justify-between">
                    <div className="flex items-start gap-3">
                        <HeadingIcon icon={UserRound} />
                        <div>
                            <div className="flex flex-wrap items-center gap-2">
                                <h2 className="text-lg font-bold text-white">
                                    {selectedUser.username}
                                </h2>
                                {selectedUser.isSuperUser && (
                                    <span className="inline-flex items-center gap-1 rounded-sm border border-border-dark bg-background-dark px-2 py-0.5 text-xs font-medium text-warning">
                                        <ShieldCheck className="h-3 w-3" />
                                        {t('admin.permissions.users.superUser')}
                                    </span>
                                )}
                                {selectedUser.isCurrentUser && (
                                    <span className="rounded-sm border border-border-dark bg-background-dark px-2 py-0.5 text-xs font-medium text-secondary-text">
                                        {t(
                                            'admin.permissions.users.currentUser',
                                        )}
                                    </span>
                                )}
                            </div>
                            <p className="mt-1 text-sm text-secondary-text">
                                {selectedUser.email}
                            </p>
                        </div>
                    </div>
                    {isDirty && (
                        <StatusIndicator tone="warning">
                            {t('admin.permissions.users.unsavedChanges')}
                        </StatusIndicator>
                    )}
                </div>

                <div className="mb-5 shrink-0 rounded-lg border border-border-dark bg-input-dark/30 p-4">
                    <div>
                        <div className="flex flex-col gap-3">
                            <CustomSelect
                                label={t('admin.permissions.users.presetLabel')}
                                value={selectedPresetId}
                                onValueChange={onSelectPreset}
                                options={presets.map((preset) => ({
                                    value: preset.id,
                                    label: preset.name,
                                }))}
                                placeholder={t(
                                    'admin.permissions.users.presetPlaceholder',
                                )}
                                className="h-11 min-w-0 flex-1 rounded-md"
                            />
                        </div>
                    </div>
                    <p className="mt-2 text-xs text-secondary-text">
                        {t('admin.permissions.users.presetHint')}
                    </p>

                    <div className="mt-4 border-t border-border-dark pt-4">
                        <div className="flex flex-wrap items-center gap-2">
                            <span className="text-xs font-semibold text-secondary-text">
                                {t('admin.permissions.users.appliedPresets')}
                            </span>
                            {appliedPresets.length > 0 && (
                                <span className="font-mono text-xs text-secondary-text">
                                    {appliedPresets.length}
                                </span>
                            )}
                        </div>
                        {appliedPresets.length > 0 ? (
                            <>
                                <div className="mt-2 flex flex-wrap gap-2">
                                    {appliedPresets.map((preset) => (
                                        <span
                                            key={preset.id}
                                            className="inline-flex items-center gap-1.5 rounded-sm border border-border-dark bg-background-dark px-2.5 py-1 text-xs font-medium text-secondary-text"
                                        >
                                            <Layers3 className="h-3.5 w-3.5 text-primary" />
                                            {preset.name}
                                        </span>
                                    ))}
                                </div>
                                <p className="mt-2 text-xs text-secondary-text">
                                    {t(
                                        'admin.permissions.users.appliedPresetHint',
                                    )}
                                </p>
                            </>
                        ) : (
                            <p className="mt-2 text-xs text-secondary-text">
                                {t('admin.permissions.users.noAppliedPresets')}
                            </p>
                        )}
                    </div>
                </div>

                <div className="flex shrink-0 flex-col xl:min-h-0 xl:flex-1">
                    <h3 className="mb-1 shrink-0 font-semibold text-white">
                        {t('admin.permissions.users.permissionsTitle')}
                    </h3>
                    <p className="mb-4 shrink-0 text-sm text-secondary-text">
                        {t('admin.permissions.users.permissionsDescription')}
                    </p>
                    <PermissionChecklist
                        permissions={permissions}
                        selectedPermissionKeys={permissionKeys}
                        isLoading={false}
                        disabled={isSaving}
                        presetPermissionKeys={presetPermissionKeys}
                        onTogglePermission={onTogglePermission}
                    />
                </div>
            </div>

            <div className="mt-5 flex shrink-0 justify-end">
                <button
                    type="button"
                    disabled={!isDirty || isSaving}
                    onClick={onSave}
                    className="inline-flex h-11 cursor-pointer items-center justify-center gap-2 rounded-md bg-primary px-5 text-sm font-semibold text-white transition-colors hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-60"
                >
                    <Save className="h-4 w-4" />
                    {isSaving
                        ? t('common.saving')
                        : t('admin.permissions.users.save')}
                </button>
            </div>
        </section>
    )
}
