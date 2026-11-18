import { DataTable } from '@rentnerkev/table'
import { Link } from '@tanstack/react-router'
import { Ban, Mail } from 'lucide-react'
import useTranslationStore from '@/language/useTranslationStore.ts'
import { getMarketplaceTableLocale } from '@/lib/Table/tableMessages.ts'
import SafeDeleteModal from '@/shared/SafeDeleteModal/index.tsx'
import StaffInvitationPermissionFields from '../StaffInvitationPermissionFields.tsx'
import useStaffInvitationColumns from './Hooks/useStaffInvitationColumns.tsx'
import useStaffInvitationManagementLogic from './Hooks/useStaffInvitationManagementLogic.ts'

export default function StaffInvitationManagement() {
    const { language, t } = useTranslationStore()
    const { state, handler } = useStaffInvitationManagementLogic()
    const columns = useStaffInvitationColumns({
        isPending: state.isPending,
        onEdit: handler.handleEdit,
        onResend: handler.handleResend,
        onToggleActive: handler.handleToggleActive,
        onRevoke: handler.handleAskRevoke,
    })

    return (
        <>
            <DataTable
                data={state.invitations}
                columns={columns}
                getRowId={(invitation) => invitation.id}
                getSearchValues={(invitation) => [
                    invitation.username,
                    invitation.email,
                ]}
                title={t('admin.staff.invitations.tableTitle')}
                icon={<Mail className="size-5" />}
                locale={getMarketplaceTableLocale(
                    language,
                    t,
                    t('admin.staff.invitations.itemLabel'),
                )}
                searchPlaceholder={t('admin.staff.invitations.search')}
                columnWidthMode="scroll"
                isLoading={state.isLoading}
                loadingState={t('admin.staff.invitations.loading')}
                emptyState={
                    state.isLoadError ? (
                        <div role="alert" className="space-y-2">
                            <p>{t('admin.staff.invitations.loadError')}</p>
                            <button
                                type="button"
                                onClick={handler.handleRetry}
                                className="rounded-md border border-border-dark px-3 py-2"
                            >
                                {t('admin.permissions.retry')}
                            </button>
                        </div>
                    ) : (
                        t('admin.staff.invitations.empty')
                    )
                }
                tableOptions={{
                    initialState: {
                        sorting: [{ id: 'expiresAt', desc: true }],
                    },
                }}
                toolbarActions={
                    <Link
                        to="/admin/staff"
                        className="rounded-md border border-border-dark px-3 py-2 text-sm font-semibold hover:bg-input-dark"
                    >
                        {t('admin.staff.inviteTitle')}
                    </Link>
                }
                expansionMode="single"
                expandedRowId={state.editTarget?.id ?? null}
                showExpandColumn={false}
                renderExpandedRow={(row) => (
                    <div className="space-y-4 p-2">
                        <h2 className="font-semibold text-white">
                            {t('admin.staff.invitations.editTitle', {
                                username: row.original.username,
                            })}
                        </h2>
                        <StaffInvitationPermissionFields
                            selection={state.permissionSelection}
                            disabled={state.isPending}
                        />
                        <div className="flex flex-wrap gap-2">
                            <button
                                type="button"
                                onClick={handler.handleCloseEdit}
                                disabled={state.isPending}
                                className="rounded-md border border-border-dark px-3 py-2 text-sm hover:bg-input-dark disabled:opacity-60"
                            >
                                {t('common.cancel')}
                            </button>
                            <button
                                type="button"
                                onClick={handler.handleSavePermissions}
                                disabled={
                                    !state.canSavePermissions || state.isPending
                                }
                                className="rounded-md bg-primary px-3 py-2 text-sm font-semibold text-white hover:bg-primary-hover disabled:opacity-60"
                            >
                                {t('common.save')}
                            </button>
                        </div>
                    </div>
                )}
            />
            <SafeDeleteModal
                isOpen={state.revokeTarget !== null}
                title={t('admin.staff.invitations.revoke')}
                description={t('admin.staff.invitations.revokeDescription')}
                question={t('admin.staff.invitations.revokeQuestion', {
                    email: state.revokeTarget?.email ?? '',
                })}
                confirmLabel={t('admin.staff.invitations.revoke')}
                confirmIcon={Ban}
                confirmingLabel={t('common.saving')}
                isConfirming={state.isPending}
                onClose={handler.handleCloseRevoke}
                onConfirm={handler.handleRevoke}
            />
        </>
    )
}
