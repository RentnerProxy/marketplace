import { useMutation } from '@tanstack/react-query'
import { useState } from 'react'
import { updateStoreDescriptionHandler } from '../middleware.ts'
import type { StoreDescriptionLogicReturn } from '../Types/app-store-component.types.ts'
import useStoreMutationFeedback from './useStoreMutationFeedback.ts'

export default function useStoreDescriptionLogic(
    appId: string,
    description: string,
): StoreDescriptionLogicReturn {
    const feedback = useStoreMutationFeedback()
    const [value, setValue] = useState(description)

    const saveMutation = useMutation({
        mutationFn: () =>
            updateStoreDescriptionHandler({
                data: { appId, description: value },
            }),
        onSuccess: (result) =>
            feedback.handleResult(result, 'appStore.description.saved'),
        onError: (error) => feedback.onError(error),
    })

    return {
        state: {
            value,
            hasChanged: value.trim() !== description.trim(),
            isSaving: saveMutation.isPending,
        },
        handler: {
            handleChange: setValue,
            handleReset: () => setValue(description),
            handleSave: () => saveMutation.mutate(),
        },
    }
}
