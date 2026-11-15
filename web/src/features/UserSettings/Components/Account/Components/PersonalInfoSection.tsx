import { TextInput } from '@rentnerkev/inputs'
import { UserRound } from 'lucide-react'
import AddressFormFields from '@/shared/AddressFormFields/index.tsx'
import SettingsSaveButton from '@/features/UserSettings/Components/SettingsSaveButton.tsx'
import usePersonalInfoSettingsLogic from '../Hooks/usePersonalInfoSettingsLogic.ts'
import type { PersonalInfoSectionProps } from '../../../Types/user-settings-component-props.types.ts'
import useTranslationStore from '@/language/useTranslationStore.ts'

export default function PersonalInfoSection({
    city,
    firstName,
    houseNumber,
    lastName,
    postalCode,
    street,
}: PersonalInfoSectionProps) {
    const { t } = useTranslationStore()
    const { state, handler } = usePersonalInfoSettingsLogic({
        city,
        firstName,
        houseNumber,
        lastName,
        postalCode,
        street,
    })

    return (
        <section className="w-full rounded-lg border border-border-dark bg-input-dark/50 p-4">
            <div>
                <h3 className="text-sm font-semibold text-white">
                    {t('userSettings.personalInfo.title')}
                </h3>
                <p className="mt-1 text-sm text-secondary-text">
                    {t('userSettings.personalInfo.description')}
                </p>
            </div>

            <div className="mt-4 grid gap-4 md:grid-cols-2">
                <TextInput
                    value={state.firstNameValue}
                    onChange={(event) =>
                        handler.handleFirstNameChange(event.target.value)
                    }
                    placeholder={t('userSettings.personalInfo.firstName')}
                    icon={<UserRound className="h-5 w-5" />}
                    maxLength={100}
                    showLength
                />

                <TextInput
                    value={state.lastNameValue}
                    onChange={(event) =>
                        handler.handleLastNameChange(event.target.value)
                    }
                    placeholder={t('userSettings.personalInfo.lastName')}
                    icon={<UserRound className="h-5 w-5" />}
                    maxLength={100}
                    showLength
                />

                <AddressFormFields
                    values={{
                        city: state.cityValue,
                        houseNumber: state.houseNumberValue,
                        postalCode: state.postalCodeValue,
                        street: state.streetValue,
                    }}
                    onChange={(key, value) => {
                        switch (key) {
                            case 'city':
                                handler.handleCityChange(value)
                                break
                            case 'houseNumber':
                                handler.handleHouseNumberChange(value)
                                break
                            case 'postalCode':
                                handler.handlePostalCodeChange(value)
                                break
                            case 'street':
                                handler.handleStreetChange(value)
                                break
                        }
                    }}
                    placeholders={{
                        city: t('userSettings.personalInfo.city'),
                        houseNumber: t('userSettings.personalInfo.houseNumber'),
                        postalCode: t('userSettings.personalInfo.postalCode'),
                        street: t('userSettings.personalInfo.street'),
                    }}
                />
            </div>

            <div className="mt-4 flex justify-end">
                <SettingsSaveButton
                    disabled={state.isSavingPersonalInfo}
                    isSaving={state.isSavingPersonalInfo}
                    onClick={handler.handleSavePersonalInfo}
                >
                    {state.isSavingPersonalInfo
                        ? t('common.saving')
                        : t('userSettings.personalInfo.save')}
                </SettingsSaveButton>
            </div>
        </section>
    )
}
