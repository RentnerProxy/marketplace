import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from '@rentnerkev/toasts'
import useTranslationStore from '@/language/useTranslationStore.ts'
import { APP_STORE_QUERY_KEY } from '@/lib/AppStore/appStoreQueries.ts'
import { AppError } from '@/lib/Errors/appError.ts'
import { SOCIAL_QUERY_KEY } from '@/lib/Social/socialQueries.ts'
import { toastAppError } from '@/shared/Errors/toastAppError.ts'
import { starAppHandler, unstarAppHandler } from '../middleware.ts'
import type { StarButtonLogicReturn } from '../Types/social-component.types.ts'
import type { ProfileApp } from '../Types/social.types.ts'

export default function useStarButtonLogic(
    app: ProfileApp,
): StarButtonLogicReturn {
    const { t } = useTranslationStore()
    const queryClient = useQueryClient()

    const starMutation = useMutation({
        mutationFn: async function () {
            const input = { data: { appId: app.appId } }
            return app.isStarred
                ? await unstarAppHandler(input)
                : await starAppHandler(input)
        },
        onSuccess: async function (result) {
            if (!result.success) {
                toastAppError(new AppError(result.error))
                return
            }

            toast.success(
                t(result.isStarred ? 'social.starred' : 'social.unstarred', {
                    name: app.name,
                }),
                { title: t('profile.stats.stars') },
            )
            await Promise.all([
                queryClient.invalidateQueries({ queryKey: SOCIAL_QUERY_KEY }),
                queryClient.invalidateQueries({
                    queryKey: APP_STORE_QUERY_KEY,
                }),
            ])
        },
        onError: function (error) {
            toastAppError(error)
        },
    })

    function handleToggleStar() {
        starMutation.mutate()
    }

    return {
        state: { isPending: starMutation.isPending },
        handler: { handleToggleStar },
    }
}
