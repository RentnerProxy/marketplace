import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from '@rentnerkev/toasts'
import useTranslationStore from '@/language/useTranslationStore.ts'
import { haveSamePermissionKeys } from '@/lib/Permissions/permissionCollections.ts'
import { STAFF_INVITATIONS_QUERY_KEY } from '@/lib/Permissions/permissionManagementCache.ts'
import { toastAppError } from '@/shared/Errors/toastAppError.ts'
import { subscribeToRealtimeEvents } from '@/websockets/Client/realtimeEventsClient.ts'
import useStaffInvitationPermissions from '../../../Hooks/useStaffInvitationPermissions.ts'
import {
    getStaffInvitationsHandler,
    manageStaffInvitationHandler,
} from '../../../middleware.ts'
import type {
    ManageStaffInvitationInput,
    StaffInvitationSummary,
} from '../../../Types/staff-invitation.types.ts'
import type { StaffInvitationManagementLogic } from '../Types/staff-invitation-management.types.ts'

export default function useStaffInvitationManagementLogic(): StaffInvitationManagementLogic {
    const { t } = useTranslationStore()
    const queryClient = useQueryClient()
    const [editTarget, setEditTarget] = useState<StaffInvitationSummary | null>(
        null,
    )
    const [revokeTarget, setRevokeTarget] =
        useState<StaffInvitationSummary | null>(null)
    const permissionSelection = useStaffInvitationPermissions()
    const invitations = useQuery({
        queryKey: STAFF_INVITATIONS_QUERY_KEY,
        queryFn: getStaffInvitationsHandler,
    })
    const { permissionKeys, isValid } = permissionSelection.state
    const canSavePermissions = Boolean(
        editTarget &&
        isValid &&
        !haveSamePermissionKeys(editTarget.permissionKeys, permissionKeys),
    )

    useEffect(
        () =>
            subscribeToRealtimeEvents(async (event) => {
                if (
                    event.type === 'admin-user.updated' ||
                    (event.type === 'admin-permissions.updated' &&
                        event.payload.scope === 'staff-invitations')
                ) {
                    await queryClient.invalidateQueries({
                        queryKey: STAFF_INVITATIONS_QUERY_KEY,
                    })
                }
            }),
        [queryClient],
    )

    const { mutate, isPending } = useMutation({
        mutationFn: (data: ManageStaffInvitationInput) =>
            manageStaffInvitationHandler({ data }),
        async onSuccess(result, data) {
            const title = t('admin.staff.invitations.title')
            if (!result.success) {
                toast.error(t(`admin.staff.inviteErrors.${result.error}`), {
                    title,
                })
                if (result.error !== 'notFound') return
            } else {
                const message =
                    data.action === 'setActive'
                        ? data.isActive
                            ? 'activated'
                            : 'deactivated'
                        : data.action
                toast.success(
                    t(`admin.staff.invitations.feedback.${message}`),
                    { title },
                )
            }
            setEditTarget((current) =>
                current?.id === data.id ? null : current,
            )
            setRevokeTarget(null)
            await queryClient.invalidateQueries({
                queryKey: STAFF_INVITATIONS_QUERY_KEY,
            })
        },
        onError: (error) => toastAppError(error),
    })

    return {
        state: {
            invitations: invitations.data ?? [],
            isLoading: invitations.isPending,
            isLoadError: invitations.isError,
            isPending,
            editTarget,
            permissionSelection,
            canSavePermissions,
            revokeTarget,
        },
        handler: {
            handleRetry() {
                void invitations.refetch().catch(toastAppError)
            },
            handleEdit(invitation) {
                setEditTarget(invitation)
                permissionSelection.handler.handleResetSelection(
                    invitation.permissionKeys,
                )
            },
            handleResend(invitation) {
                mutate({ id: invitation.id, action: 'resend' })
            },
            handleToggleActive(invitation) {
                mutate({
                    id: invitation.id,
                    action: 'setActive',
                    isActive: invitation.status === 'disabled',
                })
            },
            handleAskRevoke: setRevokeTarget,
            handleCloseRevoke: () => setRevokeTarget(null),
            handleRevoke() {
                if (revokeTarget && !isPending)
                    mutate({ id: revokeTarget.id, action: 'revoke' })
            },
            handleCloseEdit: () => setEditTarget(null),
            handleSavePermissions() {
                if (editTarget && canSavePermissions && !isPending) {
                    mutate({
                        id: editTarget.id,
                        action: 'permissions',
                        permissionKeys,
                    })
                }
            },
        },
    }
}
