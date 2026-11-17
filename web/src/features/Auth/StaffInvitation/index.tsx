import { PasswordInput } from '@rentnerkev/inputs'
import AuthFormSubmitButton from '@/shared/Auth/Components/AuthFormSubmitButton.tsx'
import AuthLayout from '@/shared/Auth/Components/AuthLayout.tsx'
import BackToLoginLink from '@/shared/Auth/Components/BackToLoginLink.tsx'
import useTranslationStore from '@/language/useTranslationStore.ts'
import { PASSWORD_POLICY } from '@/config/security.config.ts'
import useStaffInvitationLogic from './Hooks/useStaffInvitationLogic.ts'

const inputDesign = {
    bg: 'bg-white',
    border: 'border-[#cedbd1]',
    text: 'text-marketplace-void',
    labelText: 'text-[#294b35]',
}

export default function StaffInvitationPage() {
    const { t, language } = useTranslationStore()
    const { state, setter, handler } = useStaffInvitationLogic()

    return (
        <AuthLayout>
            <section aria-labelledby="staff-invitation-title">
                <h1
                    id="staff-invitation-title"
                    className="font-display text-3xl tracking-tight sm:text-4xl"
                >
                    {t('auth.staffInvitation.title')}
                </h1>
                {state.phase === 'form' ? (
                    <form onSubmit={handler.handleSubmit} className="mt-5">
                        <fieldset
                            disabled={state.isSubmitting}
                            className="space-y-3"
                        >
                            <legend className="mb-3 text-sm text-[#65786c]">
                                {t('auth.staffInvitation.description')}
                            </legend>
                            <PasswordInput
                                id="staff-invitation-password"
                                name="password"
                                label={t('marketplace.passwordLabel')}
                                value={state.password}
                                onValueChange={setter.setPassword}
                                locale={language}
                                customDesign={inputDesign}
                                minLength={PASSWORD_POLICY.minimumNewLength}
                                maxLength={PASSWORD_POLICY.maximumLength}
                                autoComplete="new-password"
                                required
                            />
                            <PasswordInput
                                id="staff-invitation-confirm-password"
                                name="confirmPassword"
                                label={t('auth.register.confirmPassword')}
                                value={state.confirmPassword}
                                onValueChange={setter.setConfirmPassword}
                                locale={language}
                                customDesign={inputDesign}
                                minLength={PASSWORD_POLICY.minimumNewLength}
                                maxLength={PASSWORD_POLICY.maximumLength}
                                autoComplete="new-password"
                                required
                            />
                            {state.error && (
                                <p
                                    role="alert"
                                    className="text-sm text-[#a41b1b]"
                                >
                                    {state.error}
                                </p>
                            )}
                            <AuthFormSubmitButton
                                isLoading={state.isSubmitting}
                                label={t('auth.staffInvitation.accept')}
                                loadingLabel={t('common.saving')}
                            />
                        </fieldset>
                    </form>
                ) : (
                    <p role="status" className="my-5 text-sm text-[#65786c]">
                        {t(`auth.staffInvitation.${state.phase}`)}
                    </p>
                )}
                <div className="mt-5">
                    <BackToLoginLink />
                </div>
            </section>
        </AuthLayout>
    )
}
