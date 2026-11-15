import { EmailInput, TextInput } from '@rentnerkev/inputs'
import { Mail, UserRound } from 'lucide-react'
import AddressFormFields from '@/shared/AddressFormFields/index.tsx'
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
                <h3 className="font-semibold text-white">
                    {t('admin.users.accountTitle')}
                </h3>
                <p className="text-sm text-secondary-text">
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

            <div className="h-px w-full bg-border-dark" />

            <div>
                <h3 className="font-semibold text-white">
                    {t('admin.users.additionalInfoTitle')}
                </h3>
                <p className="text-sm text-secondary-text">
                    {t('admin.users.additionalInfoDescription')}
                </p>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
                <TextInput
                    value={draftForm.firstName}
                    onValueChange={(value) => onFieldChange('firstName', value)}
                    placeholder={t('userSettings.personalInfo.firstName')}
                    icon={<UserRound className="h-4 w-4" />}
                    maxLength={100}
                    showLength
                />

                <TextInput
                    value={draftForm.lastName}
                    onValueChange={(value) => onFieldChange('lastName', value)}
                    placeholder={t('userSettings.personalInfo.lastName')}
                    icon={<UserRound className="h-4 w-4" />}
                    maxLength={100}
                    showLength
                />

                <AddressFormFields
                    values={{
                        city: draftForm.city,
                        houseNumber: draftForm.houseNumber,
                        postalCode: draftForm.postalCode,
                        street: draftForm.street,
                    }}
                    onChange={onFieldChange}
                    iconClassName="h-4 w-4"
                />
            </div>
        </div>
    )
}
