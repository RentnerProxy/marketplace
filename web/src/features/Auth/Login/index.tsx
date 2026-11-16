import useLoginLogic from './Hooks/useLoginLogic.ts'
import CardWave from '@/shared/Brand/CardWave.tsx'
import { LoginHeader } from './Components/LoginHeader.tsx'
import { Fingerprint, LoaderCircle, Lock, User } from 'lucide-react'
import { Link } from '@tanstack/react-router'
import { PasswordInput, TextInput } from '@rentnerkev/inputs'
import TwoFactorForm from './Components/TwoFactorForm.tsx'
import SocialLogin from '@/shared/Auth/Components/SocialLogin.tsx'
import useTranslationStore from '@/language/useTranslationStore.ts'
import type { LoginPageProps } from './Types/login-component-props.types.ts'

export default function LoginPage({ redirectReason }: LoginPageProps) {
    const { t } = useTranslationStore()
    const { state, handler, setter, form } = useLoginLogic(redirectReason)

    return (
        <div className="flex w-full items-center justify-center">
            <div className="relative isolate w-full max-w-lg overflow-hidden rounded-[2rem] border border-white/15 bg-white px-7 py-10 text-marketplace-void shadow-[0_24px_100px_rgba(0,0,0,0.2)] sm:p-10">
                <CardWave />
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
                                        customDesign={{
                                            bg: 'bg-[#f5f8f6]',
                                            border: 'border-[#cbd9d0]',
                                            text: 'text-marketplace-void',
                                            labelText: 'text-marketplace-void',
                                            placeholder:
                                                'placeholder:text-[#607468]',
                                            iconColor: 'text-[#607468]',
                                            counterText: 'text-[#607468]',
                                            counterBg: 'bg-[#f5f8f6]',
                                        }}
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
                                        customDesign={{
                                            bg: 'bg-[#f5f8f6]',
                                            border: 'border-[#cbd9d0]',
                                            text: 'text-marketplace-void',
                                            labelText: 'text-marketplace-void',
                                            placeholder:
                                                'placeholder:text-[#607468]',
                                            iconColor: 'text-[#607468]',
                                            counterText: 'text-[#607468]',
                                            counterBg: 'bg-[#f5f8f6]',
                                        }}
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
                                className="text-xs leading-6 text-[#52675d]"
                            >
                                {t('marketplace.recoveryHint')}
                            </p>

                            <div className="flex items-center justify-end mt-2">
                                <Link
                                    to="/forgot-password"
                                    aria-describedby="login-recovery-hint"
                                    className="text-sm font-medium text-[#0d6d2b] hover:text-marketplace-void hover:underline"
                                >
                                    {t('auth.login.forgotPassword')}
                                </Link>
                            </div>

                            <button
                                type="submit"
                                disabled={state.isLoading}
                                className="mt-6 flex w-full justify-center rounded-xl cursor-pointer bg-primary px-4 py-3.5 text-sm font-bold text-marketplace-void shadow-sm transition-colors hover:bg-primary-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:cursor-not-allowed disabled:opacity-60"
                            >
                                {state.isLoading
                                    ? t('auth.login.loggingIn')
                                    : t('auth.login.login')}
                            </button>

                            <div className="flex items-center gap-3 text-xs uppercase tracking-[0.12em] text-[#52675d]">
                                <span className="h-px flex-1 bg-[#dce6df]" />
                                {t('auth.login.or')}
                                <span className="h-px flex-1 bg-[#dce6df]" />
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
                                className="flex w-full cursor-pointer items-center justify-center gap-2 rounded-xl border border-[#cbd9d0] bg-[#f5f8f6] px-4 py-3.5 text-sm font-semibold text-marketplace-void transition-colors hover:border-[#0d6d2b] hover:bg-[#e9fff0] disabled:cursor-not-allowed disabled:opacity-60"
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
                        <SocialLogin />
                        <p className="mt-7 border-t border-[#dce6df] pt-6 text-center text-sm text-[#52675d]">
                            {t('auth.login.newHere')}{' '}
                            <Link
                                to="/register"
                                className="font-bold text-[#0d6d2b] underline-offset-4 hover:underline"
                            >
                                {t('auth.login.discoverRegistration')}
                            </Link>
                        </p>
                    </>
                )}
            </div>
        </div>
    )
}
