import { toast } from '@rentnerkev/toasts'
import useTranslationStore from '@/language/useTranslationStore.ts'
import type { TranslationKey } from '@/language/translation.ts'

type SubmissionFeedback<Key = TranslationKey> =
    Key extends `submissions.feedback.${infer Entry}` ? Entry : never

const knownErrors = [
    'submissionConflict',
    'ownershipChanged',
    'invalidEvidence',
    'expiredEvidence',
    'buildsUnavailable',
    'invalidInput',
] as const satisfies Array<SubmissionFeedback>

export function useSubmissionFeedback() {
    const { t } = useTranslationStore()
    return {
        success: (key: SubmissionFeedback) => {
            toast.success(t(`submissions.feedback.${key}`), {
                title: t('submissions.title'),
            })
        },
        error: (error: unknown) => {
            const key =
                (error instanceof Error &&
                    knownErrors.find((entry) => entry === error.message)) ||
                'error'
            toast.error(t(`submissions.feedback.${key}`), {
                title: t('submissions.actionFailed'),
            })
        },
    }
}
