import {
    haveSamePermissionKeys,
    withoutSuperUserPermission,
    normalizePermissionKeys,
    togglePermissionKey,
} from '@/lib/Permissions/permissionCollections.ts'
import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
    columnFilteringFeature,
    constructFilterFn,
    createColumnHelper,
    createFilteredRowModel,
    createPaginatedRowModel,
    filterFn_includesString,
    globalFilteringFeature,
    rowPaginationFeature,
    tableFeatures,
    useTable,
} from '@tanstack/react-table'
import { toast } from '@rentnerkev/toasts'
import { authenticatedSessionQueryOptions } from '@/lib/Queries/appQueries.ts'
import useTranslationStore from '@/language/useTranslationStore.ts'
import { AppError } from '@/lib/Errors/appError.ts'
import { getErrorMessage } from '@/lib/Errors/error.ts'
import { toastAppError } from '@/shared/Errors/toastAppError.ts'
import { ADMIN_USERS_QUERY_KEY } from '@/lib/UserManagement/userCache.ts'
import {
    getPermissionManagementUsersHandler,
    replaceManagedUserPermissionsHandler,
} from '../middleware.ts'
import { PERMISSION_MANAGEMENT_USERS_QUERY_KEY } from '@/lib/Permissions/permissionManagementCache.ts'
import {
    getAppliedPermissionPresets,
    getPresetPermissionKeys,
} from '@/lib/Permissions/permissionPresets.ts'
import type { PermissionManagementUser } from '../Types/permission-management-domain.types.ts'

import type {
    ManagedUserPermissionsHandler,
    ManagedUserPermissionsState,
    UseManagedUserPermissionsParams,
} from '../Types/permission-management-logic.types.ts'

const PAGE_SIZE = 10
const EMPTY_USERS: Array<PermissionManagementUser> = []
const managedUserSearchFilter = constructFilterFn({
    ...filterFn_includesString,
    resolveFilterValue: (value) => String(value).trim().toLowerCase(),
})
const managedUsersTableFeatures = tableFeatures({
    columnFilteringFeature,
    globalFilteringFeature,
    filteredRowModel: createFilteredRowModel(),
    filterFns: { managedUserSearch: managedUserSearchFilter },
    rowPaginationFeature,
    paginatedRowModel: createPaginatedRowModel(),
})
const managedUsersColumnHelper = createColumnHelper<
    typeof managedUsersTableFeatures,
    PermissionManagementUser
>()
const managedUsersColumns = managedUsersColumnHelper.columns([
    managedUsersColumnHelper.accessor('username', {
        enableGlobalFilter: true,
    }),
    managedUsersColumnHelper.accessor('email', {
        enableGlobalFilter: true,
    }),
    managedUsersColumnHelper.accessor('firstName', {
        enableGlobalFilter: true,
    }),
    managedUsersColumnHelper.accessor('lastName', {
        enableGlobalFilter: true,
    }),
])
const managedUsersInitialState = {
    pagination: {
        pageIndex: 0,
        pageSize: PAGE_SIZE,
    },
}
const getManagedUserRowId = (user: PermissionManagementUser) => user.id

export default function useManagedUserPermissions({
    enabled,
    presets,
}: UseManagedUserPermissionsParams): {
    state: ManagedUserPermissionsState
    handler: ManagedUserPermissionsHandler
} {
    const { t } = useTranslationStore()
    const queryClient = useQueryClient()
    const [selectedUser, setSelectedUser] =
        useState<PermissionManagementUser | null>(null)
    const selectedUserIdRef = useRef<string | null>(null)
    const [permissionKeys, setPermissionKeys] = useState<Array<string>>([])
    const [selectedPresetId, setSelectedPresetId] = useState('')
    const { data: sessionData } = useQuery(authenticatedSessionQueryOptions())
    const actorUserId = sessionData?.user?.id
    const usersQuery = useQuery({
        queryKey: [
            ...PERMISSION_MANAGEMENT_USERS_QUERY_KEY,
            actorUserId ?? 'anonymous',
        ],
        enabled: enabled && Boolean(actorUserId),
        queryFn: getPermissionManagementUsersHandler,
    })
    const allUsers = actorUserId
        ? (usersQuery.data ?? EMPTY_USERS)
        : EMPTY_USERS
    const managedUsersTable = useTable(
        {
            features: managedUsersTableFeatures,
            columns: managedUsersColumns,
            data: allUsers,
            getRowId: getManagedUserRowId,
            getColumnCanGlobalFilter: () => true,
            globalFilterFn: 'managedUserSearch',
            autoResetPageIndex: false,
            initialState: managedUsersInitialState,
        },
        (state) => ({
            globalFilter: state.globalFilter,
            pagination: state.pagination,
        }),
    )
    const users = managedUsersTable
        .getRowModel()
        .rows.map((row) => row.original)
    const total = managedUsersTable.getRowCount()
    const pageCount = Math.max(managedUsersTable.getPageCount(), 1)
    const pageIndex = managedUsersTable.state.pagination.pageIndex
    const setPageIndex = managedUsersTable.setPageIndex

    useEffect(() => {
        if (pageIndex >= pageCount) {
            setPageIndex(pageCount - 1)
        }
    }, [pageCount, pageIndex, setPageIndex])

    const refreshedSelectedUser = selectedUser
        ? allUsers.find((user) => user.id === selectedUser.id)
        : undefined

    if (selectedUser && refreshedSelectedUser !== undefined) {
        if (
            haveSamePermissionKeys(permissionKeys, selectedUser.permissions) &&
            permissionKeys !== refreshedSelectedUser.permissions
        ) {
            setPermissionKeys(refreshedSelectedUser.permissions)
        }

        if (selectedUser !== refreshedSelectedUser) {
            setSelectedUser(refreshedSelectedUser)
        }
    }

    const saveMutation = useMutation({
        mutationFn: async function (input: {
            userId: string
            permissionKeys: Array<string>
        }) {
            return replaceManagedUserPermissionsHandler({ data: input })
        },
        onSuccess: async function (result, input) {
            if (!result.success) {
                toastAppError(
                    new AppError(result.error, {
                        title: t('common.error'),
                    }),
                )
                return
            }

            toast.success(t('admin.permissions.users.saved'), {
                title: t('admin.permissions.title'),
            })
            await Promise.all([
                queryClient.invalidateQueries({
                    queryKey: PERMISSION_MANAGEMENT_USERS_QUERY_KEY,
                }),
                queryClient.invalidateQueries({
                    queryKey: ADMIN_USERS_QUERY_KEY,
                }),
            ])
            if (selectedUserIdRef.current === input.userId) {
                setSelectedUser((currentUser) =>
                    currentUser?.id === input.userId
                        ? {
                              ...currentUser,
                              permissions: result.permissionKeys,
                          }
                        : currentUser,
                )
                setPermissionKeys(result.permissionKeys)
            }
        },
        onError: function (error) {
            toast.error(
                getErrorMessage(error, t('admin.permissions.users.saveError')),
                { title: t('common.error') },
            )
        },
    })

    function handleSearchInputChange(value: string) {
        managedUsersTable.setGlobalFilter(value)
        managedUsersTable.firstPage()
    }

    function handlePreviousPage() {
        managedUsersTable.previousPage()
    }

    function handleNextPage() {
        managedUsersTable.nextPage()
    }

    function handleSelectUser(user: PermissionManagementUser) {
        selectedUserIdRef.current = user.id
        setSelectedUser(user)
        setPermissionKeys(user.permissions)
        setSelectedPresetId('')
    }

    function handleTogglePermission(permissionKey: string) {
        setPermissionKeys((currentPermissionKeys) =>
            togglePermissionKey(currentPermissionKeys, permissionKey),
        )
    }

    function handleSelectPreset(presetId: string) {
        const preset = presets.find(
            (currentPreset) => currentPreset.id === presetId,
        )

        setSelectedPresetId('')

        if (!preset) {
            return
        }

        setPermissionKeys((currentPermissionKeys) =>
            normalizePermissionKeys([
                ...currentPermissionKeys,
                ...withoutSuperUserPermission(preset.permissionKeys),
            ]),
        )
    }

    function handleSave() {
        if (!selectedUser) {
            return
        }

        saveMutation.mutate({
            userId: selectedUser.id,
            permissionKeys,
        })
    }

    function handleRetry() {
        void usersQuery.refetch().catch(toastAppError)
    }

    const appliedPresets = getAppliedPermissionPresets(presets, permissionKeys)

    return {
        state: {
            users,
            total,
            searchInput:
                typeof managedUsersTable.state.globalFilter === 'string'
                    ? managedUsersTable.state.globalFilter
                    : '',
            pageIndex,
            pageCount,
            canGoPrevious: managedUsersTable.getCanPreviousPage(),
            canGoNext: managedUsersTable.getCanNextPage(),
            isLoading: usersQuery.isLoading || usersQuery.isFetching,
            isError: usersQuery.isError,
            selectedUser,
            permissionKeys,
            appliedPresets,
            presetPermissionKeys: getPresetPermissionKeys(appliedPresets),
            selectedPresetId,
            isDirty: selectedUser
                ? !haveSamePermissionKeys(
                      selectedUser.permissions,
                      permissionKeys,
                  )
                : false,
            isSaving: saveMutation.isPending,
        },
        handler: {
            handleSearchInputChange,
            handlePreviousPage,
            handleNextPage,
            handleSelectUser,
            handleTogglePermission,
            handleSelectPreset,
            handleSave,
            handleRetry,
        },
    }
}
