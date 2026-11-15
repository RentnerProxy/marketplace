import useLoginLogic from './Hooks/useLoginLogic.ts'
import { LoginHeader } from './Components/LoginHeader.tsx'
import { Fingerprint, LoaderCircle, Lock, User } from 'lucide-react'
import { Link } from '@tanstack/react-router'
import { PasswordInput, TextInput } from '@rentnerkev/inputs'
import TwoFactorForm from './Components/TwoFactorForm.tsx'
import useTranslationStore from '@/language/useTranslationStore.ts'
import type { LoginPageProps } from './Types/login-component-props.types.ts'

export default function LoginPage({ redirectReason }: LoginPageProps) {
    const { t } = useTranslationStore()
    const { state, handler, setter, form } = useLoginLogic(redirectReason)

    return (
        <div className="flex w-full items-center justify-center">
            <div className="relative w-full max-w-md overflow-hidden rounded-2xl border border-border-dark bg-surface-dark p-6 sm:p-8">
                <span
                    aria-hidden="true"
                    className="pointer-events-none absolute inset-x-0 top-0 h-1 bg-primary"
                />
                {state.requiresTwoFactor ? (
                    <TwoFactorForm
                        code={state.twoFactorCode}
                        isLoading={state.isLoading}
                        isError={state.isTwoFactorError}
                        trustThisDevice={state.trustThisDevice}
                        onSubmit={handler.handleTwoFactorSubmit}
                        onChange={handler.handleTwoFactorChange}
                        setRef={handler.handleTwoFactorRef}
                        onTrustThisDeviceChange={setter.setTrustThisDevice}
                        onBackToLogin={handler.handleBackToLogin}
                    />
                ) : (
                    <>
                        <LoginHeader />

                        <form
                            onSubmit={handler.handleSubmit}
                            className="space-y-5"
                        >
                            <form.Field
                                name="username"
                                children={(field) => (
                                    <TextInput
                                        id={field.name}
                                        label={t('marketplace.usernameLabel')}
                                        autoComplete="username"
                                        value={field.state.value}
                                        required
                                        onValueChange={field.handleChange}
                                        placeholder={t(
                                            'auth.login.usernamePlaceholder',
                                        )}
                                        icon={<User className="h-5 w-5" />}
                                        maxLength={50}
                                        showLength={true}
                                    />
                                )}
                            />

                            <form.Field
                                name="password"
                                children={(field) => (
                                    <PasswordInput
                                        label={t('marketplace.passwordLabel')}
                                        autoComplete="current-password"
                                        value={field.state.value}
                                        onValueChange={field.handleChange}
                                        placeholder={t(
                                            'auth.login.passwordPlaceholder',
                                        )}
                                        required
                                        id={field.name}
                                        icon={<Lock className="h-5 w-5" />}
                                    />
                                )}
                            />

                            <p
                                id="login-recovery-hint"
                                className="text-xs leading-6 text-secondary-text"
                            >
                                {t('marketplace.recoveryHint')}
                            </p>

                            <div className="flex items-center justify-end mt-2">
                                <Link
                                    to="/forgot-password"
                                    aria-describedby="login-recovery-hint"
                                    className="text-sm font-medium text-primary hover:text-primary-hover hover:underline"
                                >
                                    {t('auth.login.forgotPassword')}
                                </Link>
                            </div>

                            <button
                                type="submit"
                                disabled={state.isLoading}
                                className="mt-6 flex w-full justify-center rounded-md cursor-pointer bg-primary px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-primary-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:cursor-not-allowed disabled:opacity-60"
                            >
                                {state.isLoading
                                    ? t('auth.login.loggingIn')
                                    : t('auth.login.login')}
                            </button>

                            <div className="flex items-center gap-3 text-xs uppercase tracking-[0.12em] text-secondary-text">
                                <span className="h-px flex-1 bg-border-dark" />
                                {t('auth.login.or')}
                                <span className="h-px flex-1 bg-border-dark" />
                            </div>

                            <p
                                id="passkey-login-description"
                                className="sr-only"
                            >
                                {t('marketplace.passkeyDescription')}
                            </p>

                            <button
                                type="button"
                                disabled={state.isPasskeyLoading}
                                onClick={handler.handlePasskeyLogin}
                                aria-describedby="passkey-login-description"
                                className="flex w-full cursor-pointer items-center justify-center gap-2 rounded-md border border-border-dark bg-input-dark px-4 py-2.5 text-sm font-semibold text-foreground transition-colors hover:border-primary/60 hover:bg-input-dark/80 disabled:cursor-not-allowed disabled:opacity-60"
                            >
                                {state.isPasskeyLoading ? (
                                    <LoaderCircle className="h-4 w-4 animate-spin" />
                                ) : (
                                    <Fingerprint className="h-4 w-4" />
                                )}

                                {state.isPasskeyLoading
                                    ? t('auth.login.passkeyLoggingIn')
                                    : t('auth.login.passkeyLogin')}
                            </button>
                        </form>
                    </>
                )}
            </div>
        </div>
    )
}
