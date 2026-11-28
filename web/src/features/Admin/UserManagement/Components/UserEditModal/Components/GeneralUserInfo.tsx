import { EmailInput, TextInput } from '@rentnerkev/inputs'
import { Mail, UserRound } from 'lucide-react'
import type { GeneralUserInfoProps } from '../Types/user-edit-modal-component-props.types.ts'
import useTranslationStore from '@/language/useTranslationStore.ts'

export default function GeneralUserInfo({
    draftForm,
    onFieldChange,
}: GeneralUserInfoProps) {
    const { t } = useTranslationStore()

    return (
        <div className="flex flex-col gap-5">
            <div>
                <h3 className="font-semibold text-foreground">
                    {t('admin.users.accountTitle')}
                </h3>
                <p className="mt-1 text-sm leading-relaxed text-secondary-text">
                    {t('admin.users.accountDescription')}
                </p>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
                <TextInput
                    value={draftForm.username}
                    onValueChange={(value) => onFieldChange('username', value)}
                    required
                    placeholder={t('admin.users.username')}
                    icon={<UserRound className="h-4 w-4" />}
                    maxLength={50}
                    showLength
                />

                <EmailInput
                    value={draftForm.email}
                    onValueChange={(value) => onFieldChange('email', value)}
                    required
                    placeholder={t('admin.users.email')}
                    icon={<Mail className="h-4 w-4" />}
                    maxLength={255}
                    showLength
                />
            </div>
        </div>
    )
}
