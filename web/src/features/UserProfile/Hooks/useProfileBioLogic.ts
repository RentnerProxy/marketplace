import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from '@rentnerkev/toasts'
import { useState } from 'react'
import { updateCurrentUserBioHandler } from '@/features/UserSettings/middleware.ts'
import useTranslationStore from '@/language/useTranslationStore.ts'
import { AppError } from '@/lib/Errors/appError.ts'
import { updateAuthenticatedSessionUserCache } from '@/lib/UserSettings/sessionCache.ts'
import { toastAppError } from '@/shared/Errors/toastAppError.ts'
import type {
    ProfileBioLogicReturn,
    ProfileBioProps,
} from '../Types/user-profile.types.ts'

export default function useProfileBioLogic({
    bio,
}: ProfileBioProps): ProfileBioLogicReturn {
    const { t } = useTranslationStore()
    const queryClient = useQueryClient()
    const [previousBio, setPreviousBio] = useState(bio)
    const [bioValue, setBioValue] = useState(bio)
    const [isEditingBio, setIsEditingBio] = useState(false)

    if (bio !== previousBio) {
        setPreviousBio(bio)
        setBioValue(bio)
    }

    const saveBioMutation = useMutation({
        mutationFn: async function () {
            return await updateCurrentUserBioHandler({
                data: { bio: bioValue },
            })
        },
        onSuccess: function (result) {
            if (!result.success) {
                toastAppError(new AppError(result.error))
                return
            }

            toast.success(t('profile.bio.saved'), {
                title: t('profile.title'),
            })
            setIsEditingBio(false)
            updateAuthenticatedSessionUserCache(queryClient, {
                bio: result.bio,
            })
        },
        onError: function (error) {
            toastAppError(error)
        },
    })

    const handleBioChange: (value: string) => void = setBioValue

    function handleStartEditingBio() {
        setBioValue(bio)
        setIsEditingBio(true)
    }

    function handleCancelEditingBio() {
        setBioValue(bio)
        setIsEditingBio(false)
    }

    function handleSaveBio() {
        saveBioMutation.mutate()
    }

    return {
        state: {
            bioValue,
            hasBioChanged: bioValue.trim() !== bio.trim(),
            isEditingBio,
            isSavingBio: saveBioMutation.isPending,
        },
        handler: {
            handleBioChange,
            handleCancelEditingBio,
            handleSaveBio,
            handleStartEditingBio,
        },
    }
}
