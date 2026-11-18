import { Ban, Mail, Pencil, PlayIcon, Power } from 'lucide-react'
import useTranslationStore from '@/language/useTranslationStore.ts'
import { ActionMenu } from '@/shared/ActionMenu/index.tsx'
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
    const isDisabled = invitation.status === 'disabled'

    return (
        <ActionMenu
            items={[
                {
                    id: 'edit-permissions',
                    label: t('admin.staff.invitations.editPermissions'),
                    disabled: isPending,
                    onSelect: () => onEdit(invitation),
                    icon: <Pencil />,
                },
                {
                    id: 'resend',
                    label: t('admin.staff.invitations.resend'),
                    disabled: isPending,
                    onSelect: () => onResend(invitation),
                    icon: <Mail />,
                },
                {
                    id: 'toggle-status',
                    label: t(
                        isDisabled ? 'common.activate' : 'common.deactivate',
                    ),
                    disabled: isPending,
                    onSelect: () => onToggleActive(invitation),
                    icon: isDisabled ? <PlayIcon /> : <Power />,
                },
                {
                    id: 'revoke',
                    label: t('admin.staff.invitations.revoke'),
                    disabled: isPending,
                    destructive: true,
                    onSelect: () => onRevoke(invitation),
                    icon: <Ban />,
                },
            ]}
        />
    )
}
