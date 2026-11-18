import type { UserTableActionsProps } from '../Types/user-management-table.types.ts'

import { ActionMenu } from '@/shared/ActionMenu/index.tsx'
import useUserTableActionsLogic from '../Hooks/useUserTableActionsLogic.ts'
import {
    LockKeyhole,
    Pencil,
    PlayIcon,
    Power,
    RefreshCw,
    Repeat2,
    Trash2,
} from 'lucide-react'
import useTranslationStore from '@/language/useTranslationStore.ts'

export default function UserTableActions(props: UserTableActionsProps) {
    const { t } = useTranslationStore()
    const { user, isConvertingAccount } = props
    const { state, handler } = useUserTableActionsLogic(props)

    return (
        <ActionMenu
            items={[
                {
                    id: 'edit',
                    label: t('admin.users.editAriaLabel'),
                    description: state.editRestriction,
                    disabled: state.isProtectedSuperUser,
                    onSelect: handler.handleEditUser,
                    icon: state.editRestriction ? <LockKeyhole /> : <Pencil />,
                },
                {
                    id: 'toggle-status',
                    label: t(
                        user.isActive ? 'common.deactivate' : 'common.activate',
                    ),
                    description: state.toggleStatusRestriction,
                    disabled: state.isToggleStatusDisabled,
                    onSelect: handler.handleToggleUserActive,
                    icon: state.toggleStatusRestriction ? (
                        <LockKeyhole />
                    ) : user.isActive ? (
                        <Power />
                    ) : (
                        <PlayIcon />
                    ),
                },
                {
                    id: 'password-reset',
                    label: t('admin.users.passwordResetAriaLabel'),
                    description: state.passwordResetRestriction,
                    disabled: state.isPasswordResetDisabled,
                    onSelect: handler.handlePasswordReset,
                    icon: <RefreshCw />,
                },
                ...(state.showConvertAccount
                    ? [
                          {
                              id: 'convert-account',
                              label: state.convertAccountLabel,
                              disabled: isConvertingAccount,
                              onSelect: handler.handleConvertAccount,
                              icon: <Repeat2 />,
                          },
                      ]
                    : []),
                {
                    id: 'delete',
                    label: t('admin.users.deleteAriaLabel'),
                    description: state.deleteRestriction,
                    disabled: state.isDeleteDisabled,
                    destructive: true,
                    onSelect: handler.handleDeleteUser,
                    icon: state.deleteRestriction ? (
                        <LockKeyhole />
                    ) : (
                        <Trash2 />
                    ),
                },
            ]}
        />
    )
}
