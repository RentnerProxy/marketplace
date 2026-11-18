import { useState } from 'react'
import type { SubmitEvent } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from '@rentnerkev/toasts'
import useTranslationStore from '@/language/useTranslationStore.ts'
import { STAFF_INVITATIONS_QUERY_KEY } from '@/lib/Permissions/permissionManagementCache.ts'
import { toastAppError } from '@/shared/Errors/toastAppError.ts'
import useStaffInvitationPermissions from '../../../Hooks/useStaffInvitationPermissions.ts'
import { inviteStaffHandler } from '../../../middleware.ts'
import type { StaffInvitationsLogic } from '../../../Types/staff-invitations-logic.types.ts'

export default function useStaffInvitationFormLogic(): StaffInvitationsLogic {
    const { t } = useTranslationStore()
    const queryClient = useQueryClient()
    const [username, setUsername] = useState('')
    const [email, setEmail] = useState('')
    const permissionSelection = useStaffInvitationPermissions()
    const canSend =
        permissionSelection.state.isValid &&
        Boolean(username.trim() && email.trim())

    const send = useMutation({
        mutationFn: inviteStaffHandler,
        async onSuccess(result) {
            const title = t('admin.staff.inviteTitle')
            if (!result.success) {
                toast.error(t(`admin.staff.inviteErrors.${result.error}`), {
                    title,
                })
                return
            }
            toast.success(t('admin.staff.inviteSent'), { title })
            setUsername('')
            setEmail('')
            permissionSelection.handler.handleResetSelection([])
            await queryClient.invalidateQueries({
                queryKey: STAFF_INVITATIONS_QUERY_KEY,
            })
        },
        onError: (error) => toastAppError(error),
    })

    function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
        event.preventDefault()
        if (!canSend || send.isPending) return
        send.mutate({
            data: {
                username,
                email,
                permissionKeys: permissionSelection.state.permissionKeys,
            },
        })
    }

    return {
        state: {
            username,
            email,
            permissionSelection,
            isSending: send.isPending,
            canSend,
        },
        setter: { setUsername, setEmail },
        handler: { handleSubmit },
    }
}
