import { TextInput } from '@rentnerkev/inputs'
import { UserRound } from 'lucide-react'
import AddressFormFields from '@/shared/AddressFormFields/index.tsx'
import useTranslationStore from '@/language/useTranslationStore.ts'
import type { FirstSuperUserFormSectionProps } from '../Types/first-super-user-component-props.types.ts'

export default function PersonalInfoSection({
    values,
    onFieldChange,
}: FirstSuperUserFormSectionProps) {
    const { t } = useTranslationStore()

    return (
        <section className="space-y-4 border-t border-border-dark pt-5">
            <div>
                <h2 className="font-semibold text-white">
                    {t('auth.firstSetup.personalInfoTitle')}
                </h2>
                <p className="text-sm text-secondary-text">
                    {t('auth.firstSetup.personalInfoDescription')}
                </p>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
                <TextInput
                    value={values.firstName}
                    onChange={(event) =>
                        onFieldChange('firstName', event.target.value)
                    }
                    placeholder={t('userSettings.personalInfo.firstName')}
                    icon={<UserRound className="h-5 w-5" />}
                    maxLength={100}
                    showLength
                />
                <TextInput
                    value={values.lastName}
                    onChange={(event) =>
                        onFieldChange('lastName', event.target.value)
                    }
                    placeholder={t('userSettings.personalInfo.lastName')}
                    icon={<UserRound className="h-5 w-5" />}
                    maxLength={100}
                    showLength
                />
                <AddressFormFields values={values} onChange={onFieldChange} />
            </div>
        </section>
    )
}
