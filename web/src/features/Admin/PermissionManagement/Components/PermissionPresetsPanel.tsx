import SafeDeleteModal from '@/shared/SafeDeleteModal/index.tsx'
import useTranslationStore from '@/language/useTranslationStore.ts'
import PermissionPresetForm from './PermissionPresetForm.tsx'
import PermissionPresetList from './PermissionPresetList.tsx'
import type { PermissionPresetsPanelProps } from '../Types/permission-management-component-props.types.ts'

export default function PermissionPresetsPanel({
    permissions,
    isLoading,
    state,
    handler,
}: PermissionPresetsPanelProps) {
    const { t } = useTranslationStore()

    return (
        <div className="grid gap-4 xl:grid-cols-[minmax(360px,0.8fr)_minmax(0,1.2fr)] xl:gap-6">
            <PermissionPresetForm
                permissions={permissions}
                isLoading={isLoading}
                formValues={state.formValues}
                isSaving={state.isSaving}
                onFieldChange={handler.handleFieldChange}
                onTogglePermission={handler.handleTogglePermission}
                onSubmit={handler.handleSubmit}
                onCancelEdit={handler.handleStartCreate}
            />
            <PermissionPresetList
                presets={state.presets}
                onStartCreate={handler.handleStartCreate}
                onStartEdit={handler.handleStartEdit}
                onAskDelete={handler.handleAskDelete}
            />
            <SafeDeleteModal
                isOpen={Boolean(state.deleteTarget)}
                title={t('admin.permissions.presets.deleteTitle')}
                question={t('admin.permissions.presets.deleteQuestion', {
                    name: state.deleteTarget?.name ?? '',
                })}
                confirmLabel={t('admin.permissions.presets.delete')}
                isConfirming={state.isDeleting}
                onClose={handler.handleCloseDeleteModal}
                onConfirm={handler.handleConfirmDelete}
            />
        </div>
    )
}
