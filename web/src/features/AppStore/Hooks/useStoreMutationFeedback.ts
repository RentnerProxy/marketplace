import { useQueryClient } from '@tanstack/react-query'
import { toast } from '@rentnerkev/toasts'
import type { TranslationKey } from '@/language/translation.ts'
import useTranslationStore from '@/language/useTranslationStore.ts'
import { APP_STORE_QUERY_KEY } from '@/lib/AppStore/appStoreQueries.ts'
import { AppError } from '@/lib/Errors/appError.ts'
import { getDataUrlByteSize } from '@/lib/Images/imageDataUrlSize.ts'
import { SOCIAL_QUERY_KEY } from '@/lib/Social/socialQueries.ts'
import { toastAppError } from '@/shared/Errors/toastAppError.ts'
import { startTransferTask } from '@/shared/TransferOverlay/Hooks/useTransferOverlayTasks.ts'
import type { StoreMutationResult } from '../Types/app-store.types.ts'

/** Shared toast and cache handling for every store listing mutation. */
export default function useStoreMutationFeedback() {
    const { t } = useTranslationStore()
    const queryClient = useQueryClient()

    async function handleResult(
        result: StoreMutationResult,
        successKey: TranslationKey,
    ) {
        if (!result.success) {
            toastAppError(new AppError(result.error))
            return false
        }

        toast.success(t(successKey), { title: t('appStore.title') })
        await Promise.all([
            queryClient.invalidateQueries({ queryKey: APP_STORE_QUERY_KEY }),
            queryClient.invalidateQueries({ queryKey: SOCIAL_QUERY_KEY }),
        ])
        return true
    }

    /** Runs an image upload with the global transfer progress overlay. */
    async function runUpload(
        imageDataUrl: string,
        title: string,
        upload: () => Promise<StoreMutationResult>,
    ) {
        const transfer = startTransferTask({
            direction: 'upload',
            title,
            totalBytes: getDataUrlByteSize(imageDataUrl),
        })

        try {
            const result = await upload()
            if (result.success) transfer.complete(title)
            else transfer.fail(result.error)
            return result
        } catch (error) {
            transfer.fail(t('appStore.uploadFailed'))
            throw error
        }
    }

    return { handleResult, runUpload, onError: toastAppError }
}
