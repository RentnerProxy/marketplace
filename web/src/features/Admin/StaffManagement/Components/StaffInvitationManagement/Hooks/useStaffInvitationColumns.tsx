import type { TableColumn } from '@rentnerkev/table/types'
import useTranslationStore from '@/language/useTranslationStore.ts'
import { formatDate } from '@/lib/Date/date.ts'
import StatusIndicator from '@/shared/StatusIndicator.tsx'
import type { StatusIndicatorTone } from '@/shared/Types/status-indicator.types.ts'
import type { StaffInvitationSummary } from '../../../Types/staff-invitation.types.ts'
import StaffInvitationActions from '../Components/StaffInvitationActions.tsx'
import type { StaffInvitationActionsProps } from '../Types/staff-invitation-management.types.ts'

const invitationStatusTone = {
    active: 'success',
    disabled: 'neutral',
    expired: 'warning',
} satisfies Record<StaffInvitationSummary['status'], StatusIndicatorTone>

export default function useStaffInvitationColumns(
    actions: Omit<StaffInvitationActionsProps, 'invitation'>,
): Array<TableColumn<StaffInvitationSummary>> {
    const { t } = useTranslationStore()
    const statuses = Object.keys(invitationStatusTone)

    return [
        {
            accessorKey: 'username',
            header: t('admin.users.username'),
            size: 185,
        },
        { accessorKey: 'email', header: t('admin.users.email'), size: 245 },
        {
            accessorKey: 'status',
            header: t('common.status'),
            size: 140,
            meta: {
                filter: {
                    type: 'select',
                    options: statuses.map((value) => ({
                        value,
                        label: t(`admin.staff.invitations.status.${value}`),
                    })),
                },
            },
            cell: ({ row }) => (
                <StatusIndicator
                    tone={invitationStatusTone[row.original.status]}
                >
                    {t(`admin.staff.invitations.status.${row.original.status}`)}
                </StatusIndicator>
            ),
        },
        {
            id: 'permissions',
            header: t('common.rights'),
            accessorFn: (invitation) => invitation.permissionKeys.length,
            size: 100,
        },
        {
            accessorKey: 'expiresAt',
            header: t('admin.staff.invitations.expiresAt'),
            size: 175,
            cell: ({ row }) => formatDate(row.original.expiresAt),
        },
        {
            id: 'actions',
            header: t('common.actions'),
            size: 200,
            minSize: 200,
            enableHiding: false,
            enableResizing: false,
            enableSorting: false,
            enableColumnFilter: false,
            cell: ({ row }) => (
                <StaffInvitationActions
                    invitation={row.original}
                    {...actions}
                />
            ),
        },
    ]
}
