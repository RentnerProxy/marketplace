import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { SOCIAL_CONFIG } from '@/config/social.config.ts'
import { searchProfilesQueryOptions } from '@/lib/Social/socialQueries.ts'
import type { PeopleSearchLogicReturn } from '../Types/people.types.ts'

const SEARCH_DEBOUNCE_MS = 250

export default function usePeopleSearchLogic(): PeopleSearchLogicReturn {
    const [query, setQuery] = useState('')
    const [debouncedQuery, setDebouncedQuery] = useState('')
    const trimmedQuery = debouncedQuery.trim()
    const canSearch = trimmedQuery.length >= SOCIAL_CONFIG.searchMinLength

    useEffect(() => {
        const timeout = window.setTimeout(
            () => setDebouncedQuery(query),
            SEARCH_DEBOUNCE_MS,
        )
        return () => window.clearTimeout(timeout)
    }, [query])

    const search = useQuery({
        ...searchProfilesQueryOptions(trimmedQuery),
        enabled: canSearch,
    })

    const handleQueryChange: (value: string) => void = setQuery

    return {
        state: {
            query,
            searchedQuery: trimmedQuery,
            canSearch,
            isSearching: canSearch && search.isPending,
            profiles: canSearch ? (search.data ?? []) : [],
        },
        handler: { handleQueryChange },
    }
}
