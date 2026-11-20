import useLoginLogic from './Hooks/useLoginLogic.ts'
import { LoginHeader } from './Components/LoginHeader.tsx'
import { ArrowRight, Fingerprint, LoaderCircle, Lock, User } from 'lucide-react'
import { Link } from '@tanstack/react-router'
import { PasswordInput, TextInput } from '@rentnerkev/inputs'
import TwoFactorForm from './Components/TwoFactorForm.tsx'
import AuthLayout from '@/shared/Auth/Components/AuthLayout.tsx'
import SocialLogin from '@/shared/Auth/Components/SocialLogin.tsx'
import useTranslationStore from '@/language/useTranslationStore.ts'
import type { LoginPageProps } from './Types/login-component-props.types.ts'

const inputDesign = {
    bg: 'bg-white',
    border: 'border-[#cedbd1]',
    text: 'text-marketplace-void',
    labelText: 'text-[#294b35]',
    placeholder: 'placeholder:text-[#728578]',
    iconColor: 'text-[#728578]',
}

export default function LoginPage({ redirectReason }: LoginPageProps) {
    const { t, language } = useTranslationStore()
    const { state, handler, setter, form } = useLoginLogic(redirectReason)

    return (
        <AuthLayout>
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
                    <SocialLogin />

                    <form
                        onSubmit={handler.handleSubmit}
                        className="mt-4 space-y-4"
                    >
                        <div className="flex items-center gap-4 text-xs font-medium text-[#65786c]">
                            <span
                                aria-hidden="true"
                                className="h-px flex-1 bg-[#d7e2d9]"
                            />
                            <span>{t('auth.experience.credentials')}</span>
                            <span
                                aria-hidden="true"
                                className="h-px flex-1 bg-[#d7e2d9]"
                            />
                        </div>

                        <div className="grid min-w-0 gap-3 sm:grid-cols-2">
                            <form.Field
                                name="username"
                                children={(field) => (
                                    <TextInput
                                        id={field.name}
                                        name={field.name}
                                        label={t('marketplace.usernameLabel')}
                                        locale={language}
                                        customDesign={inputDesign}
                                        autoComplete="username"
                                        value={field.state.value}
                                        required
                                        onValueChange={field.handleChange}
                                        placeholder={t(
                                            'auth.login.usernamePlaceholder',
                                        )}
                                        icon={<User className="h-4 w-4" />}
                                        maxLength={50}
                                    />
                                )}
                            />
                            <form.Field
                                name="password"
                                children={(field) => (
                                    <PasswordInput
                                        id={field.name}
                                        name={field.name}
                                        label={t('marketplace.passwordLabel')}
                                        locale={language}
                                        customDesign={inputDesign}
                                        autoComplete="current-password"
                                        value={field.state.value}
                                        onValueChange={field.handleChange}
                                        placeholder={t(
                                            'auth.login.passwordPlaceholder',
                                        )}
                                        required
                                        icon={<Lock className="h-4 w-4" />}
                                    />
                                )}
                            />
                        </div>

                        <div className="flex justify-end">
                            <Link
                                to="/forgot-password"
                                className="rounded text-sm font-semibold text-[#176b34] underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#0d6d2b]"
                            >
                                {t('auth.login.forgotPassword')}
                            </Link>
                        </div>

                        <div className="grid gap-3 sm:grid-cols-2">
                            <button
                                type="submit"
                                disabled={state.isLoading}
                                className="flex min-h-12 cursor-pointer items-center justify-center gap-2 rounded-xl bg-primary px-5 py-3 text-sm font-bold text-marketplace-void transition-colors hover:bg-primary-hover focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#0d6d2b] disabled:cursor-not-allowed disabled:opacity-60 motion-reduce:transition-none"
                            >
                                {state.isLoading ? (
                                    <LoaderCircle
                                        aria-hidden="true"
                                        className="h-4 w-4 animate-spin"
                                    />
                                ) : null}
                                {state.isLoading
                                    ? t('auth.login.loggingIn')
                                    : t('auth.login.login')}
                                {!state.isLoading && (
                                    <ArrowRight
                                        aria-hidden="true"
                                        className="h-4 w-4"
                                    />
                                )}
                            </button>
                            <button
                                type="button"
                                disabled={state.isPasskeyLoading}
                                onClick={handler.handlePasskeyLogin}
                                aria-describedby="passkey-login-description"
                                className="flex min-h-12 cursor-pointer items-center justify-center gap-2 rounded-xl border border-[#cedbd1] bg-transparent px-4 py-3 text-sm font-semibold text-[#294b35] transition-colors hover:border-[#81a78c] hover:bg-[#edf4ed] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#0d6d2b] disabled:cursor-not-allowed disabled:opacity-60 motion-reduce:transition-none"
                            >
                                {state.isPasskeyLoading ? (
                                    <LoaderCircle
                                        aria-hidden="true"
                                        className="h-4 w-4 animate-spin"
                                    />
                                ) : (
                                    <Fingerprint
                                        aria-hidden="true"
                                        className="h-5 w-5"
                                    />
                                )}
                                {state.isPasskeyLoading
                                    ? t('auth.login.passkeyLoggingIn')
                                    : t('auth.login.passkeyLogin')}
                            </button>
                        </div>
                        <p id="passkey-login-description" className="sr-only">
                            {t('marketplace.passkeyDescription')}
                        </p>
                    </form>

                    {state.isPublicRegistrationEnabled && (
                        <p className="mt-5 border-t border-[#d7e2d9] pt-4 text-center text-sm text-[#65786c]">
                            {t('auth.login.newHere')}{' '}
                            <Link
                                to="/register"
                                className="rounded font-bold text-[#176b34] underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#0d6d2b]"
                            >
                                {t('auth.login.discoverRegistration')}
                            </Link>
                        </p>
                    )}
                </>
            )}
        </AuthLayout>
    )
}
