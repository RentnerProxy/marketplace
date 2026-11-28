import type { ProfileSummary } from '@/features/Social/Types/social.types.ts'

export type PeopleSearchLogicReturn = {
    state: {
        query: string
        searchedQuery: string
        canSearch: boolean
        isSearching: boolean
        profiles: Array<ProfileSummary>
    }
    handler: {
        handleQueryChange: (value: string) => void
    }
}
