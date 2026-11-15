import { PASSWORD_POLICY } from '@/config/security.config.ts'
import { PasswordInput } from '@rentnerkev/inputs'
import { LoaderCircle, Lock } from 'lucide-react'
import usePasswordResetLogic from './Hooks/usePasswordResetLogic.ts'
import useTranslationStore from '@/language/useTranslationStore.ts'
import AuthFormSubmitButton from '@/shared/Auth/Components/AuthFormSubmitButton.tsx'
import BackToLoginLink from '@/shared/Auth/Components/BackToLoginLink.tsx'
import HeadingIcon from '@/shared/HeadingIcon.tsx'

export default function PasswordReset() {
    const { state, handler, form } = usePasswordResetLogic()
    const { t } = useTranslationStore()

    if (state.phase !== 'ready' && state.phase !== 'submitting') {
        return (
            <div className="w-full rounded-lg border border-border-dark bg-surface-dark p-8 text-center">
                {state.phase === 'unavailable' ? (
                    <>
                        <p
                            role="status"
                            className="text-sm text-secondary-text"
                        >
                            {t('auth.passwordReset.validationError')}
                        </p>
                        <button
                            type="button"
                            onClick={handler.handleRetryValidation}
                            className="mt-5 rounded-md bg-primary px-4 py-2 text-sm font-medium text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                        >
                            {t('auth.passwordReset.retryValidation')}
                        </button>
                    </>
                ) : (
                    <div
                        role="status"
                        className="flex items-center justify-center gap-2 text-sm text-secondary-text"
                    >
                        <LoaderCircle
                            className="h-4 w-4 animate-spin"
                            aria-hidden="true"
                        />
                        {t('auth.passwordReset.validating')}
                    </div>
                )}
            </div>
        )
    }

    return (
        <div className="flex w-full items-center justify-center">
            <div className="w-full max-w-md rounded-lg border border-border-dark bg-surface-dark p-8">
                <div className="mb-6 text-center">
                    <HeadingIcon
                        icon={Lock}
                        size="lg"
                        className="mx-auto mb-4"
                    />
                    <h2 className="text-2xl font-bold text-white">
                        {t('auth.passwordReset.newPasswordTitle')}
                    </h2>
                    <p className="mt-1 text-sm text-secondary-text">
                        {t('auth.passwordReset.newPasswordDescription')}
                    </p>
                </div>

                <form onSubmit={handler.handleSubmit} className="space-y-5">
                    <form.Field
                        name="password"
                        children={(field) => (
                            <PasswordInput
                                id={field.name}
                                value={field.state.value}
                                required
                                disabled={state.isLoading}
                                onValueChange={field.handleChange}
                                placeholder={t(
                                    'auth.passwordReset.newPasswordPlaceholder',
                                )}
                                icon={<Lock className="h-5 w-5" />}
                                minLength={PASSWORD_POLICY.minimumNewLength}
                                maxLength={PASSWORD_POLICY.maximumLength}
                                aria-describedby="reset-password-policy"
                                showPasswordStrength
                            />
                        )}
                    />

                    <form.Field
                        name="confirmPassword"
                        children={(field) => (
                            <PasswordInput
                                id={field.name}
                                value={field.state.value}
                                required
                                disabled={state.isLoading}
                                onValueChange={field.handleChange}
                                placeholder={t(
                                    'auth.passwordReset.confirmPasswordPlaceholder',
                                )}
                                icon={<Lock className="h-5 w-5" />}
                                minLength={PASSWORD_POLICY.minimumNewLength}
                                maxLength={PASSWORD_POLICY.maximumLength}
                                aria-describedby="reset-password-policy"
                                showPasswordStrength
                            />
                        )}
                    />

                    <p
                        id="reset-password-policy"
                        className="text-sm text-secondary-text"
                    >
                        {t('auth.passwordPolicy', {
                            min: PASSWORD_POLICY.minimumNewLength,
                            max: PASSWORD_POLICY.maximumLength,
                        })}
                    </p>
                    <AuthFormSubmitButton
                        isLoading={state.isLoading}
                        loadingLabel={t('auth.passwordReset.saving')}
                        label={t('auth.passwordReset.save')}
                    />
                </form>

                <BackToLoginLink />
            </div>
        </div>
    )
}
