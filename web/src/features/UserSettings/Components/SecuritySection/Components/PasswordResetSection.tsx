import { KeyRound, LoaderCircle, MailCheck } from 'lucide-react'
import useTranslationStore from '@/language/useTranslationStore.ts'
import usePasswordResetLogic from '@/features/UserSettings/Components/SecuritySection/Hooks/usePasswordResetLogic.ts'

export default function PasswordResetSection() {
    const { t } = useTranslationStore()
    const { state, handler } = usePasswordResetLogic()

    return (
        <section className="relative overflow-hidden rounded-lg border border-border-dark bg-input-dark/50 p-4">
            <div className="relative">
                <div className="flex items-center gap-2">
                    <KeyRound
                        data-pending={state.isRequestingPasswordReset}
                        className="h-4 w-4 text-primary motion-safe:transition-transform motion-safe:duration-200 motion-safe:data-[pending=true]:rotate-[-8deg] motion-safe:data-[pending=true]:scale-[1.08]"
                    />

                    <h3 className="text-sm font-semibold text-white">
                        {t('userSettings.security.passwordTitle')}
                    </h3>
                </div>

                <p className="mt-1 text-sm text-secondary-text">
                    {t('userSettings.security.passwordDescription')}
                </p>

                <button
                    type="button"
                    disabled={state.isRequestingPasswordReset}
                    onClick={handler.handleRequestPasswordReset}
                    className="mt-3 flex h-11 cursor-pointer items-center justify-center gap-2 rounded-md bg-primary px-4 text-sm font-semibold text-white transition-[background-color,scale] hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-60 motion-safe:enabled:active:scale-[0.97]"
                >
                    {state.isRequestingPasswordReset ? (
                        <LoaderCircle className="h-4 w-4 motion-safe:animate-spin" />
                    ) : (
                        <MailCheck className="h-4 w-4" />
                    )}

                    {state.isRequestingPasswordReset
                        ? t('userSettings.security.passwordSending')
                        : t('userSettings.security.passwordReset')}
                </button>
            </div>
        </section>
    )
}
