import { EmailInput, TextInput } from '@rentnerkev/inputs'
import { CustomSelect } from '@rentnerkev/select'
import { MailPlus } from 'lucide-react'
import PermissionChecklist from '@/features/Admin/PermissionManagement/Components/PermissionChecklist.tsx'
import useTranslationStore from '@/language/useTranslationStore.ts'
import { formatDate } from '@/lib/Date/date.ts'
import HeadingIcon from '@/shared/HeadingIcon.tsx'
import SafeDeleteModal from '@/shared/SafeDeleteModal/index.tsx'
import useStaffInvitationsLogic from './Hooks/useStaffInvitationsLogic.ts'

export default function StaffInvitations() {
    const { t, language } = useTranslationStore()
    const { state, handler, setter } = useStaffInvitationsLogic()

    return (
        <section className="space-y-5 rounded-lg border border-border-dark bg-surface-dark p-5">
            <div className="flex items-start gap-3">
                <HeadingIcon icon={MailPlus} />
                <div>
                    <h2 className="text-lg font-bold text-white">
                        {t('admin.staff.inviteTitle')}
                    </h2>
                    <p className="text-sm text-secondary-text">
                        {t('admin.staff.inviteDescription')}
                    </p>
                </div>
            </div>
            {state.isLoadError && (
                <div
                    role="alert"
                    className="flex flex-wrap items-center gap-3 text-sm"
                >
                    <p className="text-secondary-text">
                        {t('admin.staff.loadError')}
                    </p>
                    <button
                        type="button"
                        onClick={handler.handleRetry}
                        className="rounded-md border border-border-dark px-3 py-2"
                    >
                        {t('admin.permissions.retry')}
                    </button>
                </div>
            )}
            <form onSubmit={handler.handleSubmit}>
                <fieldset disabled={state.isSending} className="space-y-4">
                    <div className="grid gap-4 md:grid-cols-2">
                        <TextInput
                            id="invite-staff-username"
                            label={t('admin.users.username')}
                            value={state.username}
                            onValueChange={setter.setUsername}
                            locale={language}
                            maxLength={50}
                            autoComplete="off"
                            required
                        />
                        <EmailInput
                            id="invite-staff-email"
                            label={t('admin.users.email')}
                            value={state.email}
                            onValueChange={setter.setEmail}
                            locale={language}
                            maxLength={255}
                            autoComplete="off"
                            required
                        />
                    </div>
                    {state.presetOptions.length > 0 && (
                        <CustomSelect
                            label={t('admin.permissions.users.presetLabel')}
                            value={state.presetId}
                            onValueChange={handler.handleSelectPreset}
                            options={state.presetOptions}
                            placeholder={t(
                                'admin.permissions.users.presetPlaceholder',
                            )}
                        />
                    )}
                    <details
                        className="rounded-md border border-border-dark p-3"
                        open
                    >
                        <summary className="cursor-pointer text-sm font-semibold">
                            {t('admin.staff.invitePermissions')}
                        </summary>
                        <div className="mt-3">
                            <PermissionChecklist
                                permissions={state.permissions}
                                selectedPermissionKeys={state.permissionKeys}
                                isLoading={state.isLoadingPermissions}
                                disabled={state.isSending}
                                onTogglePermission={
                                    handler.handleTogglePermission
                                }
                            />
                        </div>
                    </details>
                    <button
                        type="submit"
                        disabled={!state.canSend || state.isSending}
                        className="rounded-md bg-primary px-4 py-2.5 text-sm font-semibold text-white hover:bg-primary-hover disabled:opacity-60"
                    >
                        {t(
                            state.isSending
                                ? 'common.saving'
                                : 'admin.staff.invite',
                        )}
                    </button>
                </fieldset>
            </form>
            <div className="space-y-2 border-t border-border-dark pt-4">
                <h3 className="font-semibold text-white">
                    {t('admin.staff.pendingTitle')}
                </h3>
                {state.isLoadingInvitations ? (
                    <p className="text-sm text-secondary-text">
                        {t('admin.users.loading')}
                    </p>
                ) : state.invitations.length === 0 ? (
                    <p className="text-sm text-secondary-text">
                        {t('admin.staff.noInvitations')}
                    </p>
                ) : (
                    <ul className="divide-y divide-border-dark">
                        {state.invitations.map((invitation) => (
                            <li
                                key={invitation.id}
                                className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm"
                            >
                                <div className="min-w-0 wrap-anywhere">
                                    <p className="font-semibold">
                                        {invitation.username} ·{' '}
                                        {invitation.email}
                                    </p>
                                    <p className="text-secondary-text">
                                        {t('admin.staff.expires', {
                                            date: formatDate(
                                                invitation.expiresAt,
                                            ),
                                        })}
                                    </p>
                                </div>
                                <button
                                    type="button"
                                    onClick={() =>
                                        handler.handleAskRevoke(invitation)
                                    }
                                    className="rounded-md border border-border-dark px-3 py-2 text-sm hover:bg-input-dark"
                                >
                                    {t('admin.staff.revoke')}
                                </button>
                            </li>
                        ))}
                    </ul>
                )}
            </div>
            <SafeDeleteModal
                isOpen={state.revokeTarget !== null}
                question={t('admin.staff.revokeQuestion', {
                    email: state.revokeTarget?.email ?? '',
                })}
                isConfirming={state.isRevoking}
                onClose={handler.handleCloseRevoke}
                onConfirm={handler.handleRevoke}
            />
        </section>
    )
}
