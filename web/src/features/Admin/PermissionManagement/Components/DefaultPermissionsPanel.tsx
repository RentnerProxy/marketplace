import { Info, Save, ShieldCheck } from 'lucide-react'
import useTranslationStore from '@/language/useTranslationStore.ts'
import PermissionChecklist from './PermissionChecklist.tsx'
import type { DefaultPermissionsPanelProps } from '../Types/permission-management-component-props.types.ts'
import HeadingIcon from '@/shared/HeadingIcon.tsx'

export default function DefaultPermissionsPanel({
    permissions,
    isLoading,
    state,
    handler,
}: DefaultPermissionsPanelProps) {
    const { t } = useTranslationStore()

    return (
        <section className="flex h-full min-h-0 flex-col overflow-hidden rounded-lg border border-border-dark bg-surface-dark p-5">
            <div className="flex min-h-0 flex-1 flex-col overflow-y-auto pr-1">
                <div className="mb-5 flex shrink-0 items-start gap-3">
                    <HeadingIcon icon={ShieldCheck} />
                    <div>
                        <h2 className="text-lg font-bold text-white">
                            {t('admin.permissions.defaults.title')}
                        </h2>
                        <p className="mt-1 text-sm text-secondary-text">
                            {t('admin.permissions.defaults.description')}
                        </p>
                    </div>
                </div>

                <div className="mb-5 flex shrink-0 items-start gap-3 rounded-md border border-border-dark border-l-2 border-l-primary bg-background-dark p-4 text-sm text-secondary-text">
                    <Info className="mt-0.5 h-4 w-4 shrink-0 text-secondary-text" />
                    <p>{t('admin.permissions.defaults.hint')}</p>
                </div>

                <PermissionChecklist
                    permissions={permissions}
                    selectedPermissionKeys={state.permissionKeys}
                    isLoading={isLoading}
                    disabled={state.isSaving}
                    onTogglePermission={handler.handleTogglePermission}
                />
            </div>

            <div className="mt-5 flex shrink-0 justify-end">
                <button
                    type="button"
                    disabled={isLoading || state.isSaving || !state.isDirty}
                    onClick={handler.handleSave}
                    className="inline-flex h-11 cursor-pointer items-center justify-center gap-2 rounded-md bg-primary px-5 text-sm font-semibold text-white transition-colors hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-60"
                >
                    <Save className="h-4 w-4" />
                    {state.isSaving
                        ? t('common.saving')
                        : t('admin.permissions.defaults.save')}
                </button>
            </div>
        </section>
    )
}
