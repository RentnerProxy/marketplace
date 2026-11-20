import useTranslationStore from '@/language/useTranslationStore.ts'
import type { SubmissionStatus } from '@/lib/Marketplace/Types/submission.types.ts'

const neutral = 'border-border-dark bg-input-dark text-secondary-text'
const pending = 'border-primary/25 bg-primary/8 text-primary'
const successful = 'border-success/25 bg-success/8 text-success'
const failed = 'border-danger/25 bg-danger/8 text-danger'

const statusStyles = {
    submitted: pending,
    validating: pending,
    awaitingReview: 'border-warning/25 bg-warning/8 text-warning',
    approved: successful,
    publishing: pending,
    published: successful,
    rejected: failed,
    failed,
    withdrawn: neutral,
    revoked: failed,
} satisfies Record<SubmissionStatus, string>

export default function SubmissionStatusBadge({
    status,
}: {
    status: SubmissionStatus
}) {
    const { t } = useTranslationStore()

    return (
        <span
            className={`inline-block rounded-full border px-2.5 py-1 text-xs font-medium ${statusStyles[status]}`}
        >
            {t(`submissions.status.${status}`)}
        </span>
    )
}
