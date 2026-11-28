import { useQuery } from '@tanstack/react-query'
import { storeEntryEditorQueryOptions } from '@/lib/AppStore/appStoreQueries.ts'
import type { StoreEditorPageLogicReturn } from '../Types/app-store-component.types.ts'

export default function useStoreEditorPageLogic(
    appId: string,
): StoreEditorPageLogicReturn {
    const { data, isLoading } = useQuery(storeEntryEditorQueryOptions(appId))

    return {
        state: {
            entry: data ?? null,
            isLoading,
        },
    }
}
