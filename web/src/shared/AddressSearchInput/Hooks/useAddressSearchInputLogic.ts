import type { AddressSearchInputLogicReturn } from '../Types/address-search-input.types.ts'
import { useEffect, useState } from 'react'
import type { AddressSearchInputProps } from '@/shared/AddressSearchInput/Types/address-search-input.types.ts'
import type { AddressSuggestion } from '@/lib/Address/Types/address.types.ts'
import { searchAddressSuggestions } from '@/lib/Address/addressSearch.ts'

export default function useAddressSearchInputLogic({
    onSelect,
}: AddressSearchInputProps): AddressSearchInputLogicReturn {
    const [searchValue, setSearchValue] = useState('')
    const [selectedSearchValue, setSelectedSearchValue] = useState('')
    const [suggestions, setSuggestions] = useState<Array<AddressSuggestion>>([])
    const [isLoading, setIsLoading] = useState(false)
    const [hasSearched, setHasSearched] = useState(false)
    const trimmedSearchValue = searchValue.trim()

    useEffect(() => {
        if (
            trimmedSearchValue.length < 3 ||
            trimmedSearchValue === selectedSearchValue.trim()
        ) {
            return undefined
        }

        const controller = new AbortController()
        const timeoutId = window.setTimeout(() => {
            setIsLoading(true)
            setHasSearched(true)

            searchAddressSuggestions(trimmedSearchValue, controller.signal)
                .then((results) => {
                    if (!controller.signal.aborted) setSuggestions(results)
                    return undefined
                })
                .catch((error: unknown) => {
                    if (
                        !controller.signal.aborted &&
                        !(
                            error instanceof DOMException &&
                            error.name === 'AbortError'
                        )
                    ) {
                        setSuggestions([])
                    }
                })
                .finally(() => {
                    if (!controller.signal.aborted) setIsLoading(false)
                })
        }, 350)

        return () => {
            window.clearTimeout(timeoutId)
            controller.abort()
        }
    }, [selectedSearchValue, trimmedSearchValue])

    function handleSelectSuggestion(suggestion: AddressSuggestion) {
        onSelect({
            street: suggestion.street,
            houseNumber: suggestion.houseNumber,
            postalCode: suggestion.postalCode,
            city: suggestion.city,
        })
        setSelectedSearchValue(suggestion.label)
        setSearchValue(suggestion.label)
        setSuggestions([])
        setHasSearched(false)
        setIsLoading(false)
    }

    function handleSearchValueChange(value: string) {
        setSelectedSearchValue('')
        setSearchValue(value)
        setSuggestions([])
        setHasSearched(false)
        setIsLoading(false)
    }

    return {
        state: {
            searchValue,
            selectedSearchValue,
            suggestions,
            isLoading,
            hasSearched,
            trimmedSearchValue,
        },
        handler: { handleSearchValueChange, handleSelectSuggestion },
        setter: { setSelectedSearchValue, setSearchValue },
    }
}
