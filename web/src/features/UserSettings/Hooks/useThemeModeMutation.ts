import {
    useIsMutating,
    useMutation,
    useQueryClient,
} from '@tanstack/react-query'
import { toast } from '@rentnerkev/toasts'
import { updateCurrentUserThemeModeHandler } from '@/features/UserSettings/middleware.ts'
import useTranslationStore from '@/language/useTranslationStore.ts'
import { AppError } from '@/lib/Errors/appError.ts'
import { authenticatedSessionQueryOptions } from '@/lib/Queries/appQueries.ts'
import type { UserThemeMode } from '@/lib/Theme/Types/userTheme.types.ts'
import { toastAppError } from '@/shared/Errors/toastAppError.ts'

const themeModeMutation = {
    mutationKey: ['current-user-theme-mode'],
    exact: true,
} as const

export default function useThemeModeMutation() {
    const { t } = useTranslationStore()
    const queryClient = useQueryClient()
    const isSavingThemeMode = useIsMutating(themeModeMutation) > 0
    const { mutate } = useMutation({
        mutationKey: themeModeMutation.mutationKey,
        mutationFn: updateCurrentUserThemeModeHandler,
        onSuccess: async (result) => {
            if (!result.success) {
                toastAppError(new AppError(result.error))
                return
            }

            await queryClient.invalidateQueries({
                queryKey: authenticatedSessionQueryOptions().queryKey,
            })
            toast.success(t('userSettings.theme.saved'), {
                title: t('userSettings.theme.title'),
            })
        },
        onError: (error) => toastAppError(error),
    })

    function saveThemeMode(themeMode: UserThemeMode) {
        if (!queryClient.isMutating(themeModeMutation)) {
            mutate({ data: { themeMode } })
        }
    }

    return {
        state: { isSavingThemeMode },
        handler: { saveThemeMode },
    }
}
