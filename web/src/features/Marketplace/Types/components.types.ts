import type { getReviewSubmissionHandler } from '../middleware.ts'

export type SubmissionMode = 'developer' | 'review'
export type SubmissionDetail = Awaited<
    ReturnType<typeof getReviewSubmissionHandler>
>
