import { Link } from '@tanstack/react-router'
import { EmailInput, PasswordInput, TextInput } from '@rentnerkev/inputs'
import MarketplaceLogo from '@/shared/Brand/MarketplaceLogo.tsx'
import CardWave from '@/shared/Brand/CardWave.tsx'
import SocialLogin from '@/shared/Auth/Components/SocialLogin.tsx'
import useTranslationStore from '@/language/useTranslationStore.ts'
import useRegisterLogic from './Hooks/useRegisterLogic.ts'
import {
    PASSWORD_POLICY,
    REGISTRATION_POLICY,
} from '@/config/security.config.ts'

const inputDesign = {
    bg: 'bg-[#f5f8f6]',
    border: 'border-[#cbd9d0]',
    text: 'text-marketplace-void',
    labelText: 'text-marketplace-void',
    placeholder: 'placeholder:text-[#607468]',
    iconColor: 'text-[#607468]',
}

export default function RegisterPage() {
    const { t, language } = useTranslationStore()
    const { state, handler, setter } = useRegisterLogic()
    return (
        <section
            aria-labelledby="register-title"
            className="relative isolate w-full max-w-lg overflow-hidden rounded-[2rem] border border-white/15 bg-white px-7 py-10 text-marketplace-void shadow-[0_24px_100px_rgba(0,0,0,0.2)] sm:p-10"
        >
            <CardWave />
            <div className="mb-8 flex items-center gap-3 border-b border-[#dce6df] pb-6">
                <MarketplaceLogo className="w-64 max-w-full" sizes="256px" />
            </div>
            <p className="mb-3 text-xs font-bold uppercase tracking-[0.2em] text-[#0d6d2b]">
                {t('auth.register.eyebrow')}
            </p>
            <h1
                id="register-title"
                className="font-display text-4xl leading-[1.05] tracking-tight sm:text-5xl"
            >
                {t('auth.register.title')}
            </h1>
            <p className="mt-4 text-sm leading-7 text-[#52675d]">
                {t('auth.register.description')}
            </p>
            {state.phase === 'form' ? (
                <>
                    <form
                        onSubmit={handler.handleSubmit}
                        className="mt-7 space-y-5"
                    >
                        <fieldset
                            disabled={state.isPending}
                            className="space-y-5"
                        >
                            <legend className="sr-only">
                                {t('auth.register.accountDetails')}
                            </legend>
                            {state.isSocial && (
                                <p
                                    role="status"
                                    className="rounded-xl bg-[#e9fff0] p-3 text-sm"
                                >
                                    {t('auth.register.socialDetails')}
                                </p>
                            )}
                            <TextInput
                                id="register-username"
                                name="username"
                                label={t('marketplace.usernameLabel')}
                                locale={language}
                                customDesign={inputDesign}
                                autoComplete="username"
                                required
                                pattern="[a-zA-Z0-9_-]+"
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
                                            state.errorField === 'password'
                                                ? state.error
                                                : undefined
                                        }
                                        label={t('marketplace.passwordLabel')}
                                        description={t(
                                            'auth.register.passwordPolicy',
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
                                        onValueChange={setter.setPassword}
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
                            <label className="flex items-start gap-3 text-sm leading-6 text-[#52675d]">
                                <input
                                    type="checkbox"
                                    name="acceptTerms"
                                    aria-invalid={state.errorField === 'terms'}
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
                                    className="mt-1 h-4 w-4 accent-[#0d6d2b]"
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
                                className="w-full rounded-xl bg-[#0d6d2b] px-4 py-3.5 text-sm font-bold text-white hover:bg-[#095822] disabled:opacity-60"
                            >
                                {t(
                                    state.isPending
                                        ? 'auth.register.submitting'
                                        : 'auth.register.submit',
                                )}
                            </button>
                            {state.isSocial && (
                                <button
                                    type="button"
                                    onClick={handler.handleCancelSocial}
                                    className="w-full text-sm underline"
                                >
                                    {t('auth.social.cancel')}
                                </button>
                            )}
                        </fieldset>
                    </form>
                    {!state.isSocial && <SocialLogin />}
                </>
            ) : state.phase === 'verify' ? (
                <div className="mt-7 space-y-4">
                    <p>{t('auth.register.verifyDescription')}</p>
                    <button
                        type="button"
                        disabled={state.isPending || !state.canVerify}
                        onClick={handler.handleVerify}
                        className="w-full rounded-xl bg-[#0d6d2b] p-3 font-bold text-white disabled:opacity-60"
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
                    className="mt-7 rounded-xl bg-[#e9fff0] p-4 text-sm leading-7"
                >
                    {t(
                        state.phase === 'inbox'
                            ? 'auth.register.checkInbox'
                            : 'auth.register.complete',
                    )}
                </p>
            )}
            <p className="mt-7 border-t border-[#dce6df] pt-6 text-center text-sm text-[#52675d]">
                {t('auth.register.alreadyRegistered')}{' '}
                <Link
                    to="/login"
                    className="font-bold text-[#0d6d2b] underline-offset-4 hover:underline"
                >
                    {t('auth.login.login')}
                </Link>
            </p>
        </section>
    )
}
