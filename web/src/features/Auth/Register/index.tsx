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
    border: 'border-[#cedbd1]',
    text: 'text-marketplace-void',
    labelText: 'text-[#294b35]',
    placeholder: 'placeholder:text-[#728578]',
    iconColor: 'text-[#728578]',
}

export default function RegisterPage() {
    const { t, language } = useTranslationStore()
    const { state, handler, setter } = useRegisterLogic()
    return (
        <AuthLayout>
            <section aria-labelledby="register-title">
                <p className="mb-2 text-xs font-bold uppercase tracking-[0.16em] text-[#176b34]">
                    {t('auth.register.eyebrow')}
                </p>
                <h1
                    id="register-title"
                    className="font-display text-3xl leading-[1.1] tracking-tight sm:text-4xl"
                >
                    {t('auth.register.title')}
                </h1>
                <p className="mb-4 mt-2 text-sm leading-5 text-[#65786c]">
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
                                <div className="flex items-center gap-4 text-xs font-medium text-[#65786c]">
                                    <span
                                        aria-hidden="true"
                                        className="h-px flex-1 bg-[#d7e2d9]"
                                    />
                                    <span>
                                        {t('auth.experience.emailRegistration')}
                                    </span>
                                    <span
                                        aria-hidden="true"
                                        className="h-px flex-1 bg-[#d7e2d9]"
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
                                        className="flex items-start gap-3 rounded-xl border border-[#cce4d1] bg-[#edf6ed] p-4 text-sm leading-6 text-[#294b35]"
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
                                        className="text-xs leading-5 text-[#65786c]"
                                    >
                                        {t('auth.register.passwordPolicy', {
                                            min: REGISTRATION_POLICY.minimumPasswordLength,
                                        })}
                                    </p>
                                )}
                                <label className="flex cursor-pointer items-start gap-3 text-sm leading-5 text-[#65786c]">
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
                                        className="mt-1 h-4 w-4 shrink-0 cursor-pointer rounded accent-[#0d6d2b] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#0d6d2b]"
                                    />
                                    <span>
                                        {t('auth.register.acceptTerms')}{' '}
                                        <Link
                                            to="/terms"
                                            className="font-bold text-[#0d6d2b] underline"
                                        >
                                            {t('auth.register.terms')}
                                        </Link>{' '}
                                        {t('auth.register.and')}{' '}
                                        <Link
                                            to="/privacy"
                                            className="font-bold text-[#0d6d2b] underline"
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
                                    className="flex min-h-12 w-full cursor-pointer items-center justify-center gap-2 rounded-xl bg-primary px-5 py-3 text-sm font-bold text-marketplace-void transition-colors hover:bg-primary-hover focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#0d6d2b] disabled:cursor-not-allowed disabled:opacity-60 motion-reduce:transition-none"
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
                                        className="min-h-11 w-full cursor-pointer rounded-lg text-sm text-[#176b34] underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#0d6d2b] disabled:cursor-not-allowed disabled:opacity-60"
                                    >
                                        {t('auth.social.cancel')}
                                    </button>
                                )}
                            </fieldset>
                        </form>
                    </>
                ) : state.phase === 'verify' ? (
                    <div className="mt-7 space-y-5 rounded-2xl border border-[#cce4d1] bg-white p-6">
                        <MailCheck
                            aria-hidden="true"
                            className="h-9 w-9 text-[#176b34]"
                        />
                        <p className="text-sm leading-7 text-[#53675a]">
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
                            className="min-h-[52px] w-full cursor-pointer rounded-xl bg-primary px-5 py-3 text-sm font-bold text-marketplace-void transition-colors hover:bg-primary-hover focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#0d6d2b] disabled:cursor-not-allowed disabled:opacity-60 motion-reduce:transition-none"
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
                        className="mt-7 flex items-start gap-4 rounded-2xl border border-[#cce4d1] bg-white p-6 text-sm leading-7 text-[#294b35]"
                    >
                        {state.phase === 'inbox' ? (
                            <MailCheck
                                aria-hidden="true"
                                className="mt-1 h-6 w-6 shrink-0 text-[#176b34]"
                            />
                        ) : (
                            <CheckCircle2
                                aria-hidden="true"
                                className="mt-1 h-6 w-6 shrink-0 text-[#176b34]"
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
                        className="mt-2 min-h-11 w-full cursor-pointer rounded-lg text-sm text-[#176b34] underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#0d6d2b] disabled:cursor-not-allowed disabled:opacity-60"
                    >
                        {t('auth.register.retryRegistration')}
                    </button>
                )}
                <p className="mt-5 border-t border-[#d7e2d9] pt-4 text-center text-sm text-[#65786c]">
                    {t('auth.register.alreadyRegistered')}{' '}
                    <Link
                        to="/login"
                        className="rounded font-bold text-[#176b34] underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#0d6d2b]"
                    >
                        {t('auth.login.login')}
                    </Link>
                </p>
            </section>
        </AuthLayout>
    )
}
