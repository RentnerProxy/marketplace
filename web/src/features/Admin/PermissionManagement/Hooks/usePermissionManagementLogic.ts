import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { toastAppError } from '@/shared/Errors/toastAppError.ts'
import { PERMISSIONS } from '@/config/permissions.config.ts'
import { PERMISSION_MANAGEMENT_OVERVIEW_QUERY_KEY } from '@/lib/Permissions/permissionManagementCache.ts'
import { getPermissionManagementOverviewHandler } from '../middleware.ts'
import type {
    PermissionManagementOverview,
    PermissionManagementTab,
} from '../Types/permission-management-domain.types.ts'
import type { PermissionManagementLogicReturn } from '../Types/permission-management-logic.types.ts'
import useManagedUserPermissions from './useManagedUserPermissions.ts'
import usePermissionManagementRealtime from './usePermissionManagementRealtime.ts'
import usePermissionPresets from './usePermissionPresets.ts'

const emptyOverview: PermissionManagementOverview = {
    permissions: [],
    presets: [],
}

export default function usePermissionManagementLogic(): PermissionManagementLogicReturn {
    const [activeTab, setActiveTab] = useState<PermissionManagementTab>('users')
    const overviewQuery = useQuery({
        queryKey: PERMISSION_MANAGEMENT_OVERVIEW_QUERY_KEY,
        queryFn: getPermissionManagementOverviewHandler,
    })
    const overview = overviewQuery.data ?? emptyOverview
    const assignablePermissions = useMemo(
        () =>
            overview.permissions.filter(
                (permission) => permission.key !== PERMISSIONS.ADMIN_SUPER_USER,
            ),
        [overview.permissions],
    )
    const permissionPresets = usePermissionPresets({
        presets: overview.presets,
    })
    const managedUsers = useManagedUserPermissions({
        enabled: activeTab === 'users',
        presets: overview.presets,
    })

    usePermissionManagementRealtime()

    const handleTabChange: (tab: PermissionManagementTab) => void = setActiveTab

    function handleRetryOverview() {
        void overviewQuery.refetch().catch(toastAppError)
    }

    return {
        state: {
            activeTab,
            permissions: overview.permissions,
            assignablePermissions,
            presets: overview.presets,
            isLoadingOverview:
                overviewQuery.isLoading || overviewQuery.isFetching,
            isOverviewError: overviewQuery.isError,
            permissionPresets: {
                formValues: permissionPresets.state.formValues,
                presets: permissionPresets.state.presets,
                deleteTarget: permissionPresets.state.deleteTarget,
                isSaving: permissionPresets.state.isSaving,
                isDeleting: permissionPresets.state.isDeleting,
            },
            managedUsers: {
                users: managedUsers.state.users,
                total: managedUsers.state.total,
                searchInput: managedUsers.state.searchInput,
                pageIndex: managedUsers.state.pageIndex,
                pageCount: managedUsers.state.pageCount,
                canGoPrevious: managedUsers.state.canGoPrevious,
                canGoNext: managedUsers.state.canGoNext,
                isLoading: managedUsers.state.isLoading,
                isError: managedUsers.state.isError,
                selectedUser: managedUsers.state.selectedUser,
                permissionKeys: managedUsers.state.permissionKeys,
                appliedPresets: managedUsers.state.appliedPresets,
                presetPermissionKeys: managedUsers.state.presetPermissionKeys,
                selectedPresetId: managedUsers.state.selectedPresetId,
                isDirty: managedUsers.state.isDirty,
                isSaving: managedUsers.state.isSaving,
            },
        },
        handler: {
            handleTabChange,
            handleRetryOverview,
            permissionPresets: {
                handleFieldChange: permissionPresets.handler.handleFieldChange,
                handleTogglePermission:
                    permissionPresets.handler.handleTogglePermission,
                handleSubmit: permissionPresets.handler.handleSubmit,
                handleStartCreate: permissionPresets.handler.handleStartCreate,
                handleStartEdit: permissionPresets.handler.handleStartEdit,
                handleAskDelete: permissionPresets.handler.handleAskDelete,
                handleCloseDeleteModal:
                    permissionPresets.handler.handleCloseDeleteModal,
                handleConfirmDelete:
                    permissionPresets.handler.handleConfirmDelete,
            },
            managedUsers: {
                handleSearchInputChange:
                    managedUsers.handler.handleSearchInputChange,
                handlePreviousPage: managedUsers.handler.handlePreviousPage,
                handleNextPage: managedUsers.handler.handleNextPage,
                handleSelectUser: managedUsers.handler.handleSelectUser,
                handleTogglePermission:
                    managedUsers.handler.handleTogglePermission,
                handleSelectPreset: managedUsers.handler.handleSelectPreset,
                handleSave: managedUsers.handler.handleSave,
                handleRetry: managedUsers.handler.handleRetry,
            },
        },
    }
}
