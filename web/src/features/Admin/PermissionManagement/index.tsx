import { RefreshCw } from 'lucide-react'
import useTranslationStore from '@/language/useTranslationStore.ts'
import PermissionManagementTabs from './Components/PermissionManagementTabs.tsx'
import PermissionPresetsPanel from './Components/PermissionPresetsPanel.tsx'
import UserPermissionsPanel from './Components/UserPermissionsPanel.tsx'
import usePermissionManagementLogic from './Hooks/usePermissionManagementLogic.ts'

export default function PermissionManagement() {
    const { t } = useTranslationStore()
    const { state, handler } = usePermissionManagementLogic()

    return (
        <div className="flex min-h-0 flex-1 flex-col gap-6">
            <div className="shrink-0">
                <PermissionManagementTabs
                    activeTab={state.activeTab}
                    onTabChange={handler.handleTabChange}
                />
            </div>

            <div className="min-h-0 flex-1">
                {state.isOverviewError ? (
                    <section className="flex h-full flex-col items-center justify-center gap-3 rounded-lg border border-border-dark bg-surface-dark px-5 py-10 text-center">
                        <p className="text-sm text-secondary-text">
                            {t('admin.permissions.overviewLoadError')}
                        </p>
                        <button
                            type="button"
                            onClick={handler.handleRetryOverview}
                            className="inline-flex h-10 cursor-pointer items-center gap-2 rounded-md border border-border-dark bg-input-dark px-3 text-sm font-semibold text-secondary-text transition-colors hover:text-white"
                        >
                            <RefreshCw className="h-4 w-4" />
                            {t('admin.permissions.retry')}
                        </button>
                    </section>
                ) : state.activeTab === 'presets' ? (
                    <PermissionPresetsPanel
                        permissions={state.assignablePermissions}
                        isLoading={state.isLoadingOverview}
                        state={state.permissionPresets}
                        handler={handler.permissionPresets}
                    />
                ) : (
                    <UserPermissionsPanel
                        permissions={state.permissions}
                        presets={state.presets}
                        state={state.managedUsers}
                        handler={handler.managedUsers}
                    />
                )}
            </div>
        </div>
    )
}
