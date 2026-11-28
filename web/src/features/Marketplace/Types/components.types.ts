import type {
    getReviewSubmissionHandler,
    getReviewSubmissionsHandler,
} from '../middleware.ts'

export type SubmissionMode = 'developer' | 'review'
export type SubmissionDetail = Awaited<
    ReturnType<typeof getReviewSubmissionHandler>
>
export type SubmissionRow = Awaited<
    ReturnType<typeof getReviewSubmissionsHandler>
>['submissions'][number]

export type SubmissionQueueProps = {
    mode: SubmissionMode
    userId: string
}

export type SubmissionDetailsProps = SubmissionQueueProps & {
    submission: Pick<SubmissionRow, 'id' | 'appId' | 'version'>
    onClose: () => void
}

export type SubmissionAction = {
    intent: 'approve' | 'reject' | 'revoke' | 'withdraw'
    submission: SubmissionDetail
    reason: string
}
