import { Loader2, MapPin, Search } from 'lucide-react'
import type { AddressSearchInputProps } from '@/shared/AddressSearchInput/Types/address-search-input.types.ts'
import useTranslationStore from '@/language/useTranslationStore.ts'
import useAddressSearchInputLogic from '@/shared/AddressSearchInput/Hooks/useAddressSearchInputLogic.ts'

export default function AddressSearchInput({
    onSelect,
}: AddressSearchInputProps) {
    const { handler, state } = useAddressSearchInputLogic({ onSelect })
    const { t } = useTranslationStore()

    return (
        <div className="relative md:col-span-2">
            <div className="flex h-11 items-center gap-3 rounded-md border border-border-dark bg-background-dark px-3 text-secondary-text transition-colors focus-within:border-primary/50">
                <Search className="h-4 w-4 shrink-0" />
                <input
                    value={state.searchValue}
                    onChange={(event) =>
                        handler.handleSearchValueChange(event.target.value)
                    }
                    placeholder={t('shared.addressSearch.placeholder')}
                    className="h-full min-w-0 flex-1 bg-transparent text-sm text-white outline-none placeholder:text-secondary-text"
                    type="search"
                    autoComplete="off"
                />
                {state.isLoading && (
                    <Loader2 className="h-4 w-4 shrink-0 animate-spin text-primary" />
                )}
            </div>

            {(state.suggestions.length > 0 ||
                (state.hasSearched &&
                    !state.isLoading &&
                    state.trimmedSearchValue.length >= 3)) && (
                <div className="absolute left-0 right-0 top-12 z-20 overflow-hidden rounded-md border border-border-dark bg-surface-dark shadow-xl">
                    {state.suggestions.length > 0 ? (
                        state.suggestions.map((suggestion) => (
                            <button
                                key={suggestion.id}
                                type="button"
                                onClick={() =>
                                    handler.handleSelectSuggestion(suggestion)
                                }
                                className="flex w-full cursor-pointer items-start gap-3 border-b border-border-dark px-3 py-3 text-left text-sm text-secondary-text transition-colors last:border-b-0 hover:bg-input-dark hover:text-white"
                            >
                                <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                                <span className="line-clamp-2">
                                    {suggestion.label}
                                </span>
                            </button>
                        ))
                    ) : (
                        <div className="px-3 py-3 text-sm text-secondary-text">
                            {t('shared.addressSearch.noSuggestions')}
                        </div>
                    )}
                </div>
            )}
        </div>
    )
}
