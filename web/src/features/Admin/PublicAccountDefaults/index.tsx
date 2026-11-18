import DefaultPermissionsPanel from '@/features/Admin/PermissionManagement/Components/DefaultPermissionsPanel.tsx'
import useTranslationStore from '@/language/useTranslationStore.ts'
import usePublicAccountDefaultsLogic from './Hooks/usePublicAccountDefaultsLogic.ts'

export default function PublicAccountDefaultsPage() {
    const { t } = useTranslationStore()
    const { state, handler } = usePublicAccountDefaultsLogic()

    if (state.isError) {
        return (
            <section className="space-y-3 rounded-lg border border-border-dark bg-surface-dark p-5">
                <p role="alert" className="text-sm text-secondary-text">
                    {t('admin.permissions.defaults.loadError')}
                </p>
                <button
                    type="button"
                    onClick={handler.handleRetry}
                    className="rounded-md border border-border-dark bg-input-dark px-3 py-2 text-sm"
                >
                    {t('admin.permissions.retry')}
                </button>
            </section>
        )
    }

    return (
        <DefaultPermissionsPanel
            permissions={state.permissions}
            isLoading={state.isLoading}
            state={state}
            handler={handler}
        />
    )
}
