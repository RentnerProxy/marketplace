import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from '@rentnerkev/toasts'
import useTranslationStore from '@/language/useTranslationStore.ts'
import { AppError } from '@/lib/Errors/appError.ts'
import { SOCIAL_QUERY_KEY } from '@/lib/Social/socialQueries.ts'
import { toastAppError } from '@/shared/Errors/toastAppError.ts'
import { followUserHandler, unfollowUserHandler } from '../middleware.ts'
import type { FollowButtonLogicReturn } from '../Types/social-component.types.ts'
import type { ProfileSummary } from '../Types/social.types.ts'

export default function useFollowButtonLogic(
    profile: ProfileSummary,
): FollowButtonLogicReturn {
    const { t } = useTranslationStore()
    const queryClient = useQueryClient()

    const followMutation = useMutation({
        mutationFn: async function () {
            const input = { data: { userId: profile.id } }
            return profile.isFollowing
                ? await unfollowUserHandler(input)
                : await followUserHandler(input)
        },
        onSuccess: async function (result) {
            if (!result.success) {
                toastAppError(new AppError(result.error))
                return
            }

            toast.success(
                t(
                    result.isFollowing
                        ? 'social.followed'
                        : 'social.unfollowed',
                    {
                        username: profile.username,
                    },
                ),
                { title: t('social.title') },
            )
            await queryClient.invalidateQueries({ queryKey: SOCIAL_QUERY_KEY })
        },
        onError: function (error) {
            toastAppError(error)
        },
    })

    function handleToggleFollow() {
        followMutation.mutate()
    }

    return {
        state: { isPending: followMutation.isPending },
        handler: { handleToggleFollow },
    }
}
