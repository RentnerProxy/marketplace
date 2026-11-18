import { Ban, Mail, Pencil, PlayIcon, Power } from 'lucide-react'
import useTranslationStore from '@/language/useTranslationStore.ts'
import TableActionButton from '@/shared/Table/TableActionButton.tsx'
import type { StaffInvitationActionsProps } from '../Types/staff-invitation-management.types.ts'

export default function StaffInvitationActions({
    invitation,
    isPending,
    onEdit,
    onResend,
    onToggleActive,
    onRevoke,
}: StaffInvitationActionsProps) {
    const { t } = useTranslationStore()
    const editLabel = t('admin.staff.invitations.editPermissions')
    const resendLabel = t('admin.staff.invitations.resend')
    const revokeLabel = t('admin.staff.invitations.revoke')
    const isDisabled = invitation.status === 'disabled'
    const toggleLabel = t(isDisabled ? 'common.activate' : 'common.deactivate')

    return (
        <div className="flex items-center gap-2">
            <TableActionButton
                ariaLabel={editLabel}
                tooltip={editLabel}
                disabled={isPending}
                onClick={() => onEdit(invitation)}
                className="hover:border-primary/40 hover:text-white"
            >
                <Pencil className="size-4" />
            </TableActionButton>
            <TableActionButton
                ariaLabel={resendLabel}
                tooltip={resendLabel}
                disabled={isPending}
                onClick={() => onResend(invitation)}
                className="hover:border-primary/40 hover:text-white"
            >
                <Mail className="size-4" />
            </TableActionButton>
            <TableActionButton
                ariaLabel={toggleLabel}
                tooltip={toggleLabel}
                disabled={isPending}
                onClick={() => onToggleActive(invitation)}
                className="hover:border-yellow-400/40 hover:text-yellow-300"
            >
                {isDisabled ? (
                    <PlayIcon className="size-4" />
                ) : (
                    <Power className="size-4" />
                )}
            </TableActionButton>
            <TableActionButton
                ariaLabel={revokeLabel}
                tooltip={revokeLabel}
                disabled={isPending}
                onClick={() => onRevoke(invitation)}
                className="hover:border-red-500/40 hover:text-red-300"
            >
                <Ban className="size-4" />
            </TableActionButton>
        </div>
    )
}
