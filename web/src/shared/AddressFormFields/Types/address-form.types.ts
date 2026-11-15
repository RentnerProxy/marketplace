import type { AddressSearchValue } from '@/lib/Address/Types/address.types.ts'

export type AddressFormFieldPlaceholders = {
    street: string
    houseNumber: string
    postalCode: string
    city: string
}

export type AddressFormFieldsProps = {
    values: AddressSearchValue
    onChange: <TKey extends keyof AddressSearchValue>(
        key: TKey,
        value: AddressSearchValue[TKey],
    ) => void
    placeholders?: AddressFormFieldPlaceholders
    iconClassName?: string
}

export type AddressFormFieldsLogicReturn = {
    state: {
        placeholders: AddressFormFieldPlaceholders
    }
    handler: {
        handleAddressSelect: (address: AddressSearchValue) => void
    }
}
