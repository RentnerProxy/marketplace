import { EmailInput } from '@rentnerkev/inputs'
import { Mail } from 'lucide-react'
import usePasswordForgotLogic from '@/features/Auth/ForgotPassword/Hooks/usePasswordForgotLogic.ts'
import useTranslationStore from '@/language/useTranslationStore.ts'
import AuthFormSubmitButton from '@/shared/Auth/Components/AuthFormSubmitButton.tsx'
import BackToLoginLink from '@/shared/Auth/Components/BackToLoginLink.tsx'
import HeadingIcon from '@/shared/HeadingIcon.tsx'

export default function ForgotPassword() {
    const { t } = useTranslationStore()
    const { state, handler, form } = usePasswordForgotLogic()

    return (
        <div className="flex w-full items-center justify-center">
            <div className="w-full max-w-md rounded-lg border border-border-dark bg-surface-dark p-8">
                <div className="mb-6 text-center">
                    <HeadingIcon
                        icon={Mail}
                        size="lg"
                        className="mx-auto mb-4"
                    />
                    <h2 className="text-2xl font-bold text-white">
                        {t('auth.forgotPassword.title')}
                    </h2>
                    <p className="mt-1 text-sm text-secondary-text">
                        {t('auth.forgotPassword.description')}
                    </p>
                </div>

                <form onSubmit={handler.handleSubmit} className="space-y-5">
                    <form.Field
                        name="email"
                        children={(field) => (
                            <EmailInput
                                id={field.name}
                                value={field.state.value}
                                required
                                onValueChange={field.handleChange}
                                placeholder={t(
                                    'auth.forgotPassword.emailPlaceholder',
                                )}
                                icon={<Mail className="h-5 w-5" />}
                                maxLength={120}
                                showLength={true}
                            />
                        )}
                    />

                    <AuthFormSubmitButton
                        isLoading={state.isLoading}
                        loadingLabel={t('auth.forgotPassword.requesting')}
                        label={t('auth.forgotPassword.requestLink')}
                    />
                </form>

                <BackToLoginLink />
            </div>
        </div>
    )
}
