import { toast } from '@rentnerkev/toasts'
import useTranslationStore from '@/language/useTranslationStore.ts'

export function useSubmissionFeedback() {
    const { t } = useTranslationStore()
    return {
        success: (key: string) => {
            toast.success(t('submissions.feedback.' + key), {
                title: t('submissions.title'),
            })
        },
        error: (error: unknown) => {
            const known = [
                'submissionConflict',
                'ownershipChanged',
                'invalidEvidence',
                'expiredEvidence',
                'buildsUnavailable',
                'invalidInput',
            ]
            const key =
                error instanceof Error && known.includes(error.message)
                    ? error.message
                    : 'error'
            toast.error(t('submissions.feedback.' + key), {
                title: t('submissions.actionFailed'),
            })
        },
    }
}
