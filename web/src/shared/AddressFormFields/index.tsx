import { TextInput } from '@rentnerkev/inputs'
import { Hash, Home, MapPin, Signpost } from 'lucide-react'

import AddressSearchInput from '@/shared/AddressSearchInput/index.tsx'
import type { AddressFormFieldsProps } from './Types/address-form.types.ts'
import useAddressFormFieldsLogic from './Hooks/useAddressFormFieldsLogic.ts'

export default function AddressFormFields({
    iconClassName = 'h-5 w-5',
    onChange,
    placeholders,
    values,
}: AddressFormFieldsProps) {
    const { state, handler } = useAddressFormFieldsLogic({
        onChange,
        placeholders,
    })

    return (
        <>
            <AddressSearchInput onSelect={handler.handleAddressSelect} />

            <TextInput
                value={values.street}
                onChange={(event) => onChange('street', event.target.value)}
                placeholder={state.placeholders.street}
                icon={<Signpost className={iconClassName} />}
                maxLength={100}
                showLength
            />

            <TextInput
                value={values.houseNumber}
                onChange={(event) =>
                    onChange('houseNumber', event.target.value)
                }
                placeholder={state.placeholders.houseNumber}
                icon={<Home className={iconClassName} />}
                maxLength={20}
                showLength
            />

            <TextInput
                value={values.postalCode}
                onChange={(event) => onChange('postalCode', event.target.value)}
                placeholder={state.placeholders.postalCode}
                icon={<Hash className={iconClassName} />}
                maxLength={20}
                showLength
            />

            <TextInput
                value={values.city}
                onChange={(event) => onChange('city', event.target.value)}
                placeholder={state.placeholders.city}
                icon={<MapPin className={iconClassName} />}
                maxLength={100}
                showLength
            />
        </>
    )
}
