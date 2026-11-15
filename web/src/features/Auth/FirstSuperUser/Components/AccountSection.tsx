import { PASSWORD_POLICY } from '@/config/security.config.ts'
import { EmailInput, PasswordInput, TextInput } from '@rentnerkev/inputs'
import { Lock, Mail, User } from 'lucide-react'
import useTranslationStore from '@/language/useTranslationStore.ts'
import type { FirstSuperUserFormSectionProps } from '../Types/first-super-user-component-props.types.ts'

export default function AccountSection({
    values,
    onFieldChange,
}: FirstSuperUserFormSectionProps) {
    const { t } = useTranslationStore()

    return (
        <section className="space-y-4">
            <div>
                <h2 className="font-semibold text-white">
                    {t('auth.firstSetup.accountTitle')}
                </h2>
                <p className="text-sm text-secondary-text">
                    {t('auth.firstSetup.accountDescription')}
                </p>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
                <TextInput
                    value={values.username}
                    onValueChange={(value) => onFieldChange('username', value)}
                    placeholder={t('auth.login.usernamePlaceholder')}
                    icon={<User className="h-5 w-5" />}
                    maxLength={50}
                    required
                    showLength
                />
                <EmailInput
                    value={values.email}
                    onValueChange={(value) => onFieldChange('email', value)}
                    placeholder={t('auth.firstSetup.emailPlaceholder')}
                    icon={<Mail className="h-5 w-5" />}
                    maxLength={255}
                    required
                    showLength
                />
                <PasswordInput
                    value={values.password}
                    onValueChange={(value) => onFieldChange('password', value)}
                    placeholder={t('auth.firstSetup.passwordPlaceholder')}
                    icon={<Lock className="h-5 w-5" />}
                    minLength={PASSWORD_POLICY.minimumNewLength}
                    maxLength={PASSWORD_POLICY.maximumLength}
                    aria-describedby="first-setup-password-policy"
                    showPasswordStrength
                    required
                />
                <PasswordInput
                    value={values.confirmPassword}
                    onValueChange={(value) =>
                        onFieldChange('confirmPassword', value)
                    }
                    placeholder={t(
                        'auth.firstSetup.confirmPasswordPlaceholder',
                    )}
                    icon={<Lock className="h-5 w-5" />}
                    minLength={PASSWORD_POLICY.minimumNewLength}
                    maxLength={PASSWORD_POLICY.maximumLength}
                    aria-describedby="first-setup-password-policy"
                    showPasswordStrength
                    required
                />
            </div>
            <p
                id="first-setup-password-policy"
                className="text-sm text-secondary-text"
            >
                {t('auth.passwordPolicy', {
                    min: PASSWORD_POLICY.minimumNewLength,
                    max: PASSWORD_POLICY.maximumLength,
                })}
            </p>
        </section>
    )
}
