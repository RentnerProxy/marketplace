import { useEffect, useState } from 'react'
import type { SubmitEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from '@rentnerkev/toasts'
import { PERMISSIONS } from '@/config/permissions.config.ts'
import { getPermissionManagementOverviewHandler } from '@/features/Admin/PermissionManagement/middleware.ts'
import usePermissionManagementRealtime from '@/features/Admin/PermissionManagement/Hooks/usePermissionManagementRealtime.ts'
import useTranslationStore from '@/language/useTranslationStore.ts'
import { getDefaultRouteForPermissions } from '@/lib/Permissions/permissions.ts'
import { togglePermissionKey } from '@/lib/Permissions/permissionCollections.ts'
import { PERMISSION_MANAGEMENT_OVERVIEW_QUERY_KEY } from '@/lib/Permissions/permissionManagementCache.ts'
import { subscribeToRealtimeEvents } from '@/websockets/Client/realtimeEventsClient.ts'
import { toastAppError } from '@/shared/Errors/toastAppError.ts'
import {
    getStaffInvitationsHandler,
    inviteStaffHandler,
    revokeStaffInvitationHandler,
} from '../../../middleware.ts'
import type {
    StaffInvitationsLogic,
    StaffInvitationSummary,
} from '../../../Types/staff-invitations-logic.types.ts'

const invitationsQueryKey = [
    'admin-permission-management',
    'staff-invitations',
] as const

export default function useStaffInvitationsLogic(): StaffInvitationsLogic {
    const { t } = useTranslationStore()
    const queryClient = useQueryClient()
    const [username, setUsername] = useState('')
    const [email, setEmail] = useState('')
    const [presetId, setPresetId] = useState('')
    const [permissionKeys, setPermissionKeys] = useState<Array<string>>([])
    const [revokeTarget, setRevokeTarget] =
        useState<StaffInvitationSummary | null>(null)
    const overview = useQuery({
        queryKey: PERMISSION_MANAGEMENT_OVERVIEW_QUERY_KEY,
        queryFn: getPermissionManagementOverviewHandler,
    })
    const invitations = useQuery({
        queryKey: invitationsQueryKey,
        queryFn: getStaffInvitationsHandler,
    })
    const permissions =
        overview.data?.permissions.filter(
            (permission) => permission.key !== PERMISSIONS.ADMIN_SUPER_USER,
        ) ?? []
    const presets = overview.data?.presets ?? []
    const canSend =
        !overview.isPending &&
        !overview.isError &&
        getDefaultRouteForPermissions(permissionKeys) !== '/login'

    usePermissionManagementRealtime()
    useEffect(
        () =>
            subscribeToRealtimeEvents(async (event) => {
                if (event.type === 'admin-user.updated')
                    await queryClient.invalidateQueries({
                        queryKey: invitationsQueryKey,
                    })
            }),
        [queryClient],
    )

    const send = useMutation({
        mutationFn: inviteStaffHandler,
        async onSuccess(result) {
            if (!result.success) {
                toast.error(t(`admin.staff.inviteErrors.${result.error}`), {
                    title: t('admin.staff.inviteTitle'),
                })
                return
            }
            toast.success(t('admin.staff.inviteSent'), {
                title: t('admin.staff.inviteTitle'),
            })
            setUsername('')
            setEmail('')
            setPresetId('')
            setPermissionKeys([])
            await queryClient.invalidateQueries({
                queryKey: invitationsQueryKey,
            })
        },
        onError: () =>
            toast.error(t('admin.staff.inviteErrors.deliveryFailed'), {
                title: t('admin.staff.inviteTitle'),
            }),
    })
    const revoke = useMutation({
        mutationFn: revokeStaffInvitationHandler,
        async onSuccess() {
            setRevokeTarget(null)
            toast.success(t('admin.staff.revoked'), {
                title: t('admin.staff.pendingTitle'),
            })
            await queryClient.invalidateQueries({
                queryKey: invitationsQueryKey,
            })
        },
        onError: () =>
            toast.error(t('admin.staff.revokeError'), {
                title: t('admin.staff.pendingTitle'),
            }),
    })

    function handleSelectPreset(id: string) {
        setPresetId(id)
        const selected = presets.find((preset) => preset.id === id)
        setPermissionKeys(selected?.permissionKeys ?? [])
    }

    function handleTogglePermission(key: string) {
        setPresetId('')
        setPermissionKeys((current) => togglePermissionKey(current, key))
    }

    function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
        event.preventDefault()
        if (!canSend || send.isPending) return
        send.mutate({ data: { username, email, permissionKeys } })
    }

    return {
        state: {
            username,
            email,
            permissionKeys,
            permissions,
            presetId,
            presetOptions: presets.map(({ id, name }) => ({
                value: id,
                label: name,
            })),
            invitations: invitations.data ?? [],
            isLoadingPermissions: overview.isPending,
            isLoadingInvitations: invitations.isPending,
            isLoadError: overview.isError || invitations.isError,
            isSending: send.isPending,
            canSend,
            revokeTarget,
            isRevoking: revoke.isPending,
        },
        setter: { setUsername, setEmail },
        handler: {
            handleSelectPreset,
            handleTogglePermission,
            handleSubmit,
            handleRetry() {
                void Promise.all([
                    overview.refetch(),
                    invitations.refetch(),
                ]).catch(toastAppError)
            },
            handleAskRevoke: setRevokeTarget,
            handleCloseRevoke: () => setRevokeTarget(null),
            handleRevoke() {
                if (revokeTarget && !revoke.isPending)
                    revoke.mutate({ data: { id: revokeTarget.id } })
            },
        },
    }
}
