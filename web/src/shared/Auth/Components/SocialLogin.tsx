import { TextInput } from '@rentnerkev/inputs'
import { ArrowRight } from 'lucide-react'
import type { SocialProviderId } from '@/lib/Auth/Types/social-auth.types.ts'
import useSocialLoginLogic from '../Hooks/useSocialLoginLogic.ts'
import useTranslationStore from '@/language/useTranslationStore.ts'
import SocialProviderIcon from './SocialProviderIcon.tsx'

const providerStyles: Record<SocialProviderId, string> = {
    google: 'border-[#dadce0] bg-white text-[#1f1f1f] enabled:hover:border-[#bdc1c6] enabled:hover:bg-[#f8faff]',
    github: 'border-[#24292f] bg-[#24292f] text-white enabled:hover:border-[#32383f] enabled:hover:bg-[#32383f]',
    discord:
        'border-[#5865f2] bg-[#5865f2] text-white enabled:hover:border-[#4752c4] enabled:hover:bg-[#4752c4]',
}

export default function SocialLogin() {
    const { state, handler, setter } = useSocialLoginLogic()
    const { t } = useTranslationStore()
    return (
        <div className="space-y-3">
            {state.requiresTwoFactor ? (
                <form
                    onSubmit={handler.handleSubmit}
                    aria-busy={state.isPending}
                    className="space-y-3"
                >
                    <label
                        htmlFor="social-two-factor"
                        className="block text-sm font-semibold"
                    >
                        {t('auth.social.twoFactor')}
                    </label>
                    <TextInput
                        id="social-two-factor"
                        name="twoFactorCode"
                        inputMode="numeric"
                        autoComplete="one-time-code"
                        pattern="[0-9]{6}"
                        maxLength={6}
                        required
                        disabled={state.isPending}
                        validationMode="external"
                        value={state.code}
                        aria-invalid={Boolean(state.error)}
                        aria-describedby={
                            state.error ? 'social-two-factor-error' : undefined
                        }
                        onValueChange={setter.setCode}
                        customDesign={{
                            bg: 'bg-[#f5f8f6]',
                            border: 'border-[#cbd9d0]',
                            text: 'text-marketplace-void',
                        }}
                    />
                    {state.error && (
                        <p
                            id="social-two-factor-error"
                            role="alert"
                            className="text-sm text-red-800"
                        >
                            {state.error}
                        </p>
                    )}
                    <button
                        disabled={state.isPending}
                        className="min-h-[52px] w-full cursor-pointer rounded-xl bg-[#0d6d2b] px-4 py-3 font-bold text-white transition-colors enabled:hover:bg-[#09551f] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#0d6d2b] disabled:cursor-not-allowed disabled:opacity-60 motion-reduce:transition-none"
                    >
                        {t('auth.social.confirm')}
                    </button>
                    <button
                        type="button"
                        disabled={state.isPending}
                        onClick={handler.handleCancel}
                        className="min-h-11 w-full cursor-pointer rounded-xl text-sm underline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#0d6d2b] disabled:cursor-not-allowed disabled:opacity-60"
                    >
                        {t('auth.social.cancel')}
                    </button>
                </form>
            ) : (
                state.providers.length > 0 && (
                    <div
                        className="space-y-3"
                        role="group"
                        aria-label={t('auth.social.title')}
                        aria-busy={state.isPending}
                    >
                        {state.providers.map((provider) => (
                            <button
                                key={provider.id}
                                type="button"
                                disabled={state.isPending}
                                aria-busy={state.isPending}
                                onClick={() => handler.handleBegin(provider.id)}
                                className={`grid min-h-[52px] w-full cursor-pointer grid-cols-[24px_minmax(0,1fr)_24px] items-center gap-3 rounded-xl border px-4 py-3 text-sm font-semibold shadow-sm transition-colors focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#0d6d2b] disabled:cursor-not-allowed disabled:opacity-60 motion-reduce:transition-none ${providerStyles[provider.id]}`}
                            >
                                <SocialProviderIcon provider={provider.id} />
                                <span className="text-center leading-5">
                                    {t('auth.social.continue', {
                                        provider: provider.name,
                                    })}
                                </span>
                                <ArrowRight
                                    aria-hidden="true"
                                    className="h-4 w-4 justify-self-end opacity-60"
                                />
                            </button>
                        ))}
                    </div>
                )
            )}
        </div>
    )
}
