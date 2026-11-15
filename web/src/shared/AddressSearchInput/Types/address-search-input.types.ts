import type { Dispatch, SetStateAction } from 'react'
import type {
    AddressSearchValue,
    AddressSuggestion,
} from '@/lib/Address/Types/address.types.ts'

export type AddressSearchInputProps = {
    onSelect: (value: AddressSearchValue) => void
}

export type AddressSearchInputLogicReturn = {
    state: {
        searchValue: string
        selectedSearchValue: string
        suggestions: AddressSuggestion[]
        isLoading: boolean
        hasSearched: boolean
        trimmedSearchValue: string
    }
    handler: {
        handleSearchValueChange: (value: string) => void
        handleSelectSuggestion: (suggestion: AddressSuggestion) => void
    }
    setter: {
        setSelectedSearchValue: Dispatch<SetStateAction<string>>
        setSearchValue: Dispatch<SetStateAction<string>>
    }
}
