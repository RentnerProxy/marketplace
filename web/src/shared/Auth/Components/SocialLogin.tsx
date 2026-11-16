import useSocialLoginLogic from '../Hooks/useSocialLoginLogic.ts'
import useTranslationStore from '@/language/useTranslationStore.ts'

export default function SocialLogin() {
    const { state, handler, setter } = useSocialLoginLogic()
    const { t } = useTranslationStore()
    return (
        <div className="mt-6 space-y-3">
            {state.requiresTwoFactor ? (
                <form onSubmit={handler.handleSubmit} className="space-y-3">
                    <label
                        htmlFor="social-two-factor"
                        className="block text-sm font-semibold"
                    >
                        {t('auth.social.twoFactor')}
                    </label>
                    <input
                        id="social-two-factor"
                        name="twoFactorCode"
                        inputMode="numeric"
                        autoComplete="one-time-code"
                        pattern="[0-9]{6}"
                        maxLength={6}
                        required
                        value={state.code}
                        aria-invalid={Boolean(state.error)}
                        aria-describedby={
                            state.error ? 'social-two-factor-error' : undefined
                        }
                        onChange={(event) => setter.setCode(event.target.value)}
                        className="w-full rounded-xl border border-[#cbd9d0] bg-[#f5f8f6] px-4 py-3 text-marketplace-void"
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
                        className="w-full rounded-xl bg-[#0d6d2b] p-3 font-bold text-white disabled:opacity-60"
                    >
                        {t('auth.social.confirm')}
                    </button>
                    <button
                        type="button"
                        disabled={state.isPending}
                        onClick={handler.handleCancel}
                        className="w-full text-sm underline"
                    >
                        {t('auth.social.cancel')}
                    </button>
                </form>
            ) : (
                state.providers.length > 0 && (
                    <div
                        className="space-y-3 border-t border-[#dce6df] pt-5"
                        aria-label={t('auth.social.title')}
                    >
                        <p className="text-center text-sm text-[#52675d]">
                            {t('auth.social.title')}
                        </p>
                        {state.providers.map((provider) => (
                            <button
                                key={provider.id}
                                type="button"
                                disabled={state.isPending}
                                onClick={() => handler.handleBegin(provider.id)}
                                className="w-full rounded-xl border border-[#cbd9d0] bg-[#f5f8f6] px-4 py-3 text-sm font-semibold hover:bg-[#e9fff0] disabled:opacity-60"
                            >
                                {t('auth.social.continue', {
                                    provider: provider.name,
                                })}
                            </button>
                        ))}
                    </div>
                )
            )}
        </div>
    )
}
