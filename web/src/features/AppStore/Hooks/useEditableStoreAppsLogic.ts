import { useQuery } from '@tanstack/react-query'
import { editableStoreAppsQueryOptions } from '@/lib/AppStore/appStoreQueries.ts'
import type { EditableStoreAppsLogicReturn } from '../Types/app-store-component.types.ts'

export default function useEditableStoreAppsLogic(): EditableStoreAppsLogicReturn {
    const { data, isLoading } = useQuery(editableStoreAppsQueryOptions())

    return { state: { apps: data ?? [], isLoading } }
}
