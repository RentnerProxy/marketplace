import { useState, type SubmitEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CANDIDATE_PIPELINE } from '@/config/submissions.config.ts'
import useTranslationStore from '@/language/useTranslationStore.ts'
import {
    getDeveloperSubmissionHandler,
    getReviewSubmissionHandler,
    reviewSubmissionHandler,
    revokeSubmissionHandler,
    withdrawSubmissionHandler,
} from '../../../middleware.ts'
import { decisionInput, stopInput } from '../../../validation.ts'
import type {
    SubmissionAction,
    SubmissionMode,
} from '../../../Types/components.types.ts'
import { useSubmissionFeedback } from '../../../Hooks/useSubmissionFeedback.ts'

export function useSubmissionDetailsLogic(
    mode: SubmissionMode,
    userId: string,
    id: string,
) {
    const { language } = useTranslationStore()
    const [reason, setReason] = useState('')
    const client = useQueryClient()
    const feedback = useSubmissionFeedback()

    const detail = useQuery({
        queryKey: ['marketplace-submissions', userId, mode, 'detail', id],
        queryFn: ({ signal }) =>
            (mode === 'review'
                ? getReviewSubmissionHandler
                : getDeveloperSubmissionHandler)({
                data: { id },
                signal,
            }),
        refetchInterval: CANDIDATE_PIPELINE.pollMs,
    })
    const current = detail.isError ? undefined : detail.data
    const status = current?.status
    const canReview =
        mode === 'review' &&
        status === 'awaitingReview' &&
        Boolean(current?.validation)
    const canRevoke =
        mode === 'review' &&
        ['approved', 'publishing', 'published'].includes(status ?? '')
    const canWithdraw =
        mode === 'developer' &&
        [
            'submitted',
            'validating',
            'awaitingReview',
            'approved',
            'publishing',
        ].includes(status ?? '')

    const action = useMutation({
        mutationFn: async ({
            intent,
            submission,
            reason: submittedReason,
        }: SubmissionAction) => {
            const data = {
                id: submission.id,
                revision: submission.revision,
                reason: submittedReason,
            }
            if (intent === 'approve' || intent === 'reject') {
                const parsed = decisionInput.safeParse({
                    ...data,
                    candidateId: submission.validation?.candidate.id,
                    action: intent,
                })
                if (!parsed.success) throw new Error('invalidInput')
                return reviewSubmissionHandler({ data: parsed.data })
            }
            const parsed = stopInput.safeParse(data)
            if (!parsed.success) throw new Error('invalidInput')
            return (
                intent === 'withdraw'
                    ? withdrawSubmissionHandler
                    : revokeSubmissionHandler
            )({ data: parsed.data })
        },
        onSuccess: async (_, { intent }) => {
            setReason('')
            await client.invalidateQueries({
                queryKey: ['marketplace-submissions', userId, mode],
            })
            feedback.success(intent)
        },
        onError: async (error) => {
            feedback.error(error)
            await detail.refetch()
        },
    })

    function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
        event.preventDefault()
        const intent = event.nativeEvent.submitter?.getAttribute('value')
        if (!current || action.isPending) return
        if (
            ((intent === 'approve' || intent === 'reject') && canReview) ||
            (intent === 'revoke' && canRevoke) ||
            (intent === 'withdraw' && canWithdraw)
        ) {
            action.mutate({ intent, submission: current, reason })
        }
    }

    return {
        state: {
            detail: current,
            isPending: detail.isPending,
            isError: detail.isError,
            reason,
            canReview,
            canRevoke,
            canWithdraw,
            language,
            actionPending: action.isPending,
        },
        setter: { setReason },
        handler: { handleSubmit },
    }
}
