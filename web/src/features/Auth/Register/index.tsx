import { Link } from '@tanstack/react-router'
import { EmailInput, PasswordInput, TextInput } from '@rentnerkev/inputs'
import { ArrowRight, CheckCircle2, MailCheck, UserRound } from 'lucide-react'
import AuthLayout from '@/shared/Auth/Components/AuthLayout.tsx'
import SocialLogin from '@/shared/Auth/Components/SocialLogin.tsx'
import useTranslationStore from '@/language/useTranslationStore.ts'
import useRegisterLogic from './Hooks/useRegisterLogic.ts'
import {
    PASSWORD_POLICY,
    REGISTRATION_POLICY,
} from '@/config/security.config.ts'

const inputDesign = {
    bg: 'bg-white',
    border: 'border-ink',
    text: 'text-marketplace-void',
    labelText: 'text-ink',
    placeholder: 'placeholder:text-steel-600',
    iconColor: 'text-steel-600',
}

export function RegistrationClosed() {
    const { t } = useTranslationStore()
    return (
        <AuthLayout>
            <h1 className="comic-title text-5xl sm:text-6xl">
                {t('auth.register.title')}
            </h1>
            <p className="mt-3 text-sm leading-6 text-steel-600">
                {t('auth.register.disabled')}
            </p>
            <Link
                to="/login"
                className="mt-5 inline-block rounded font-bold text-proxy-800 underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ink"
            >
                {t('auth.login.login')}
            </Link>
        </AuthLayout>
    )
}

export default function RegisterPage() {
    const { t, language } = useTranslationStore()
    const { state, handler, setter } = useRegisterLogic()
    return (
        <AuthLayout>
            <section aria-labelledby="register-title">
                <p className="comic-caption mb-4">
                    {t('auth.register.eyebrow')}
                </p>
                <h1
                    id="register-title"
                    className="comic-title text-5xl sm:text-6xl"
                >
                    {t('auth.register.title')}
                </h1>
                <p className="mb-4 mt-2 text-sm leading-5 text-steel-600">
                    {t('auth.experience.emailHint')}
                </p>
                {state.phase === 'form' ? (
                    <>
                        {!state.isSocial && <SocialLogin />}
                        <form
                            onSubmit={handler.handleSubmit}
                            className="mt-4 space-y-3"
                        >
                            {!state.isSocial && (
                                <div className="flex items-center gap-4 text-xs font-medium text-steel-600">
                                    <span
                                        aria-hidden="true"
                                        className="h-px flex-1 bg-ink/25"
                                    />
                                    <span>
                                        {t('auth.experience.emailRegistration')}
                                    </span>
                                    <span
                                        aria-hidden="true"
                                        className="h-px flex-1 bg-ink/25"
                                    />
                                </div>
                            )}
                            <fieldset
                                disabled={state.isPending}
                                className="space-y-3"
                            >
                                <legend className="sr-only">
                                    {t('auth.register.accountDetails')}
                                </legend>
                                {state.isSocial && (
                                    <p
                                        role="status"
                                        className="flex items-start gap-3 rounded-md border-2 border-ink bg-proxy-50 p-4 shadow-[3px_3px_0_0_var(--color-ink)] text-sm leading-6 text-ink"
                                    >
                                        <UserRound
                                            aria-hidden="true"
                                            className="mt-0.5 h-5 w-5 shrink-0"
                                        />
                                        {t('auth.register.socialDetails')}
                                    </p>
                                )}
                                <div className="grid min-w-0 grid-cols-2 gap-3">
                                    <TextInput
                                        id="register-username"
                                        name="username"
                                        label={t('marketplace.usernameLabel')}
                                        locale={language}
                                        customDesign={inputDesign}
                                        autoComplete="username"
                                        required
                                        pattern="[a-zA-Z0-9_\x2D]+"
                                        minLength={3}
                                        maxLength={50}
                                        value={state.username}
                                        onValueChange={setter.setUsername}
                                    />
                                    <EmailInput
                                        id="register-email"
                                        name="email"
                                        label={t('auth.register.email')}
                                        locale={language}
                                        customDesign={inputDesign}
                                        autoComplete="email"
                                        required
                                        maxLength={254}
                                        value={state.email}
                                        onValueChange={setter.setEmail}
                                    />
                                    {!state.isSocial && (
                                        <>
                                            <PasswordInput
                                                id="register-password"
                                                name="password"
                                                error={
                                                    state.errorField ===
                                                    'password'
                                                        ? state.error
                                                        : undefined
                                                }
                                                label={t(
                                                    'marketplace.passwordLabel',
                                                )}
                                                aria-describedby="registration-password-policy"
                                                placeholder={t(
                                                    'auth.experience.passwordHint',
                                                    {
                                                        min: REGISTRATION_POLICY.minimumPasswordLength,
                                                    },
                                                )}
                                                locale={language}
                                                customDesign={inputDesign}
                                                autoComplete="new-password"
                                                required
                                                minLength={
                                                    REGISTRATION_POLICY.minimumPasswordLength
                                                }
                                                maxLength={
                                                    PASSWORD_POLICY.maximumLength
                                                }
                                                value={state.password}
                                                onValueChange={
                                                    setter.setPassword
                                                }
                                            />
                                            <PasswordInput
                                                id="register-confirm-password"
                                                name="confirmPassword"
                                                error={
                                                    state.errorField ===
                                                    'confirmPassword'
                                                        ? state.error
                                                        : undefined
                                                }
                                                label={t(
                                                    'auth.register.confirmPassword',
                                                )}
                                                locale={language}
                                                customDesign={inputDesign}
                                                aria-describedby="registration-password-policy"
                                                autoComplete="new-password"
                                                required
                                                minLength={
                                                    REGISTRATION_POLICY.minimumPasswordLength
                                                }
                                                maxLength={
                                                    PASSWORD_POLICY.maximumLength
                                                }
                                                value={state.confirmPassword}
                                                onValueChange={
                                                    setter.setConfirmPassword
                                                }
                                            />
                                        </>
                                    )}
                                </div>
                                {!state.isSocial && (
                                    <p
                                        id="registration-password-policy"
                                        className="text-xs leading-5 text-steel-600"
                                    >
                                        {t('auth.register.passwordPolicy', {
                                            min: REGISTRATION_POLICY.minimumPasswordLength,
                                        })}
                                    </p>
                                )}
                                <label className="flex cursor-pointer items-start gap-3 text-sm leading-5 text-steel-600">
                                    <input
                                        type="checkbox"
                                        name="acceptTerms"
                                        aria-invalid={
                                            state.errorField === 'terms'
                                        }
                                        aria-describedby={
                                            state.errorField === 'terms'
                                                ? 'register-terms-error'
                                                : undefined
                                        }
                                        required
                                        checked={state.acceptTerms}
                                        onChange={(event) =>
                                            setter.setAcceptTerms(
                                                event.target.checked,
                                            )
                                        }
                                        className="mt-1 h-4 w-4 shrink-0 cursor-pointer rounded accent-[#0d6d2b] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ink"
                                    />
                                    <span>
                                        {t('auth.register.acceptTerms')}{' '}
                                        <Link
                                            to="/terms"
                                            className="font-bold text-proxy-800 underline"
                                        >
                                            {t('auth.register.terms')}
                                        </Link>{' '}
                                        {t('auth.register.and')}{' '}
                                        <Link
                                            to="/privacy"
                                            className="font-bold text-proxy-800 underline"
                                        >
                                            {t('auth.register.privacy')}
                                        </Link>
                                        .
                                    </span>
                                </label>
                                {state.errorField === 'terms' && (
                                    <p
                                        id="register-terms-error"
                                        role="alert"
                                        className="text-sm text-red-800"
                                    >
                                        {state.error}
                                    </p>
                                )}
                                <button
                                    type="submit"
                                    disabled={state.isPending}
                                    className="flex min-h-12 w-full cursor-pointer items-center justify-center gap-2 rounded-xl bg-primary px-5 py-3 text-sm font-bold text-marketplace-void transition-colors hover:bg-primary-hover focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ink disabled:cursor-not-allowed disabled:opacity-60 motion-reduce:transition-none"
                                >
                                    {t(
                                        state.isPending
                                            ? 'auth.register.submitting'
                                            : 'auth.register.submit',
                                    )}
                                    <ArrowRight
                                        aria-hidden="true"
                                        className="h-4 w-4"
                                    />
                                </button>
                                {state.isSocial && (
                                    <button
                                        type="button"
                                        onClick={handler.handleCancelSocial}
                                        disabled={state.isPending}
                                        className="min-h-11 w-full cursor-pointer rounded-lg text-sm text-proxy-800 underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ink disabled:cursor-not-allowed disabled:opacity-60"
                                    >
                                        {t('auth.social.cancel')}
                                    </button>
                                )}
                            </fieldset>
                        </form>
                    </>
                ) : state.phase === 'verify' ? (
                    <div className="mt-7 space-y-5 rounded-md border-[3px] border-ink bg-white p-6 shadow-[5px_5px_0_0_var(--color-ink)]">
                        <MailCheck
                            aria-hidden="true"
                            className="h-9 w-9 text-proxy-800"
                        />
                        <p className="text-sm leading-7 text-steel-600">
                            {t(
                                state.canVerify
                                    ? 'auth.register.verifyDescription'
                                    : 'auth.register.invalidVerification',
                            )}
                        </p>
                        <button
                            type="button"
                            disabled={state.isPending || !state.canVerify}
                            onClick={handler.handleVerify}
                            className="min-h-[52px] w-full cursor-pointer rounded-xl bg-primary px-5 py-3 text-sm font-bold text-marketplace-void transition-colors hover:bg-primary-hover focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ink disabled:cursor-not-allowed disabled:opacity-60 motion-reduce:transition-none"
                        >
                            {t(
                                state.isPending
                                    ? 'auth.register.submitting'
                                    : 'auth.register.verify',
                            )}
                        </button>
                    </div>
                ) : (
                    <p
                        role="status"
                        className="mt-7 flex items-start gap-4 rounded-md border-[3px] border-ink bg-white p-6 shadow-[5px_5px_0_0_var(--color-ink)] text-sm leading-7 text-ink"
                    >
                        {state.phase === 'inbox' ? (
                            <MailCheck
                                aria-hidden="true"
                                className="mt-1 h-6 w-6 shrink-0 text-proxy-800"
                            />
                        ) : (
                            <CheckCircle2
                                aria-hidden="true"
                                className="mt-1 h-6 w-6 shrink-0 text-proxy-800"
                            />
                        )}
                        {t(
                            state.phase === 'inbox'
                                ? 'auth.register.checkInbox'
                                : 'auth.register.complete',
                        )}
                    </p>
                )}
                {(state.phase === 'inbox' || state.phase === 'verify') && (
                    <button
                        type="button"
                        onClick={handler.handleRetry}
                        disabled={state.isPending}
                        className="mt-2 min-h-11 w-full cursor-pointer rounded-lg text-sm text-proxy-800 underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ink disabled:cursor-not-allowed disabled:opacity-60"
                    >
                        {t('auth.register.retryRegistration')}
                    </button>
                )}
                <p className="mt-5 border-t border-dashed border-ink/40 pt-4 text-center text-sm text-steel-600">
                    {t('auth.register.alreadyRegistered')}{' '}
                    <Link
                        to="/login"
                        className="rounded font-bold text-proxy-800 underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ink"
                    >
                        {t('auth.login.login')}
                    </Link>
                </p>
            </section>
        </AuthLayout>
    )
}
