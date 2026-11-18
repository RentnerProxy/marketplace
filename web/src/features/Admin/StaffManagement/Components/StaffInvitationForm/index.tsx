import { EmailInput, TextInput } from '@rentnerkev/inputs'
import { Link } from '@tanstack/react-router'
import { MailPlus } from 'lucide-react'
import useTranslationStore from '@/language/useTranslationStore.ts'
import HeadingIcon from '@/shared/HeadingIcon.tsx'
import StaffInvitationPermissionFields from '../StaffInvitationPermissionFields.tsx'
import useStaffInvitationFormLogic from './Hooks/useStaffInvitationFormLogic.ts'

export default function StaffInvitationForm() {
    const { t, language } = useTranslationStore()
    const { state, handler, setter } = useStaffInvitationFormLogic()

    return (
        <section className="space-y-5 rounded-lg border border-border-dark bg-surface-dark p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
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
                <Link
                    to="/admin/staff-invitations"
                    className="rounded-md border border-border-dark px-3 py-2 text-sm font-semibold hover:bg-input-dark"
                >
                    {t('admin.staff.invitations.manage')}
                </Link>
            </div>
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
                    <details className="rounded-md border border-border-dark p-3">
                        <summary className="cursor-pointer text-sm font-semibold">
                            {t('admin.staff.invitePermissions')}
                            <span className="ml-2 text-xs font-normal text-secondary-text">
                                {t('admin.users.rightsCount', {
                                    count: state.permissionSelection.state
                                        .permissionKeys.length,
                                })}
                            </span>
                        </summary>
                        <div className="mt-3 space-y-3">
                            <p className="text-sm text-secondary-text">
                                {t(
                                    'admin.staff.inviteErrors.invalidPermissions',
                                )}
                            </p>
                            <StaffInvitationPermissionFields
                                selection={state.permissionSelection}
                                disabled={state.isSending}
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
        </section>
    )
}
