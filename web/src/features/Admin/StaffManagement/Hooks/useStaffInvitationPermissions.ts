import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { PERMISSIONS } from '@/config/permissions.config.ts'
import usePermissionManagementRealtime from '@/features/Admin/PermissionManagement/Hooks/usePermissionManagementRealtime.ts'
import { getPermissionManagementOverviewHandler } from '@/features/Admin/PermissionManagement/middleware.ts'
import { getDefaultRouteForPermissions } from '@/lib/Permissions/permissions.ts'
import { togglePermissionKey } from '@/lib/Permissions/permissionCollections.ts'
import { PERMISSION_MANAGEMENT_OVERVIEW_QUERY_KEY } from '@/lib/Permissions/permissionManagementCache.ts'
import { toastAppError } from '@/shared/Errors/toastAppError.ts'
import type { StaffInvitationPermissionSelection } from '../Types/staff-invitations-logic.types.ts'

export default function useStaffInvitationPermissions(): StaffInvitationPermissionSelection {
    const [presetId, setPresetId] = useState('')
    const [selectedKeys, setSelectedKeys] = useState<Array<string>>([])
    const overview = useQuery({
        queryKey: PERMISSION_MANAGEMENT_OVERVIEW_QUERY_KEY,
        queryFn: getPermissionManagementOverviewHandler,
    })
    usePermissionManagementRealtime()

    const permissions =
        overview.data?.permissions.filter(
            ({ key }) => key !== PERMISSIONS.ADMIN_SUPER_USER,
        ) ?? []
    const availableKeys = new Set(permissions.map(({ key }) => key))
    const permissionKeys = selectedKeys.filter((key) => availableKeys.has(key))
    const presets = overview.data?.presets ?? []

    return {
        state: {
            permissionKeys,
            permissions,
            presetId,
            presetOptions: presets.map(({ id, name }) => ({
                value: id,
                label: name,
            })),
            isLoadingPermissions: overview.isPending,
            isLoadError: overview.isError,
            isValid:
                overview.isSuccess &&
                getDefaultRouteForPermissions(permissionKeys) !== '/login',
        },
        handler: {
            handleSelectPreset(id) {
                setPresetId(id)
                setSelectedKeys(
                    presets.find((preset) => preset.id === id)
                        ?.permissionKeys ?? [],
                )
            },
            handleTogglePermission(key) {
                setPresetId('')
                setSelectedKeys((current) => togglePermissionKey(current, key))
            },
            handleRetry() {
                void overview.refetch().catch(toastAppError)
            },
            handleResetSelection(keys) {
                setPresetId('')
                setSelectedKeys(keys)
            },
        },
    }
}
