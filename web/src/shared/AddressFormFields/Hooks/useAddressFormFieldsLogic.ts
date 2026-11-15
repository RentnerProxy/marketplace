import useTranslationStore from '@/language/useTranslationStore.ts'
import type { AddressSearchValue } from '@/lib/Address/Types/address.types.ts'
import type {
    AddressFormFieldsLogicReturn,
    AddressFormFieldsProps,
} from '../Types/address-form.types.ts'

export default function useAddressFormFieldsLogic({
    onChange,
    placeholders,
}: Pick<
    AddressFormFieldsProps,
    'onChange' | 'placeholders'
>): AddressFormFieldsLogicReturn {
    const { t } = useTranslationStore()

    function handleAddressSelect(address: AddressSearchValue) {
        onChange('street', address.street)
        onChange('houseNumber', address.houseNumber)
        onChange('postalCode', address.postalCode)
        onChange('city', address.city)
    }

    return {
        state: {
            placeholders: placeholders ?? {
                city: t('userSettings.personalInfo.city'),
                houseNumber: t('userSettings.personalInfo.houseNumber'),
                postalCode: t('userSettings.personalInfo.postalCode'),
                street: t('userSettings.personalInfo.street'),
            },
        },
        handler: {
            handleAddressSelect,
        },
    }
}
