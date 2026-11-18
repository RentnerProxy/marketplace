import { useState, type SubmitEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CANDIDATE_PIPELINE } from '@/config/submissions.config.ts'
import useTranslationStore from '@/language/useTranslationStore.ts'
import {
    getDeveloperSubmissionHandler,
    getDeveloperSubmissionsHandler,
    getReviewSubmissionHandler,
    getReviewSubmissionsHandler,
    reviewSubmissionHandler,
    revokeSubmissionHandler,
    withdrawSubmissionHandler,
} from '../middleware.ts'
import { decisionInput, stopInput } from '../validation.ts'
import type { SubmissionMode } from '../Types/components.types.ts'
import { useSubmissionFeedback } from './useSubmissionFeedback.ts'

export function useSubmissionQueueLogic(mode: SubmissionMode, userId: string) {
    const { language } = useTranslationStore()
    const [page, setPage] = useState(0)
    const [selectedId, setSelectedId] = useState<string>()
    const [reason, setReason] = useState('')
    const client = useQueryClient()
    const feedback = useSubmissionFeedback()

    const list = useQuery({
        queryKey: ['marketplace-submissions', userId, mode, 'list', page],
        queryFn: ({ signal }) =>
            (mode === 'review'
                ? getReviewSubmissionsHandler
                : getDeveloperSubmissionsHandler)({
                data: { page },
                signal,
            }),
        refetchInterval: CANDIDATE_PIPELINE.pollMs,
    })
    const id = selectedId ?? list.data?.submissions[0]?.id
    const detail = useQuery({
        queryKey: ['marketplace-submissions', userId, mode, 'detail', id],
        queryFn: ({ signal }) =>
            (mode === 'review'
                ? getReviewSubmissionHandler
                : getDeveloperSubmissionHandler)({
                data: { id: id ?? '' },
                signal,
            }),
        enabled: Boolean(id),
        refetchInterval: CANDIDATE_PIPELINE.pollMs,
    })
    const current = detail.data
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
        mutationFn: async (intent: string) => {
            if (!current) throw new Error('submissionConflict')
            const data = { id: current.id, revision: current.revision, reason }
            if (intent === 'approve' || intent === 'reject') {
                const parsed = decisionInput.safeParse({
                    ...data,
                    candidateId: current.validation?.candidate.id,
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
        onSuccess: async (_, intent) => {
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

    function select(nextId: string) {
        setReason('')
        setSelectedId(nextId)
    }

    function changePage(delta: number) {
        setReason('')
        setSelectedId(undefined)
        setPage((currentPage) => currentPage + delta)
    }

    function submit(event: SubmitEvent<HTMLFormElement>) {
        event.preventDefault()
        const value = event.nativeEvent.submitter?.getAttribute('value')
        if (value && !action.isPending) action.mutate(value)
    }

    return {
        state: {
            list,
            detail,
            id,
            page,
            reason,
            canReview,
            canRevoke,
            canWithdraw,
            language,
            actionPending: action.isPending,
        },
        setter: { setReason },
        handler: { select, changePage, submit },
    }
}
