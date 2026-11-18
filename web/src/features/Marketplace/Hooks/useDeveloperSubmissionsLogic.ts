import { useRef, useState, type SubmitEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CANDIDATE_PIPELINE } from '@/config/submissions.config.ts'
import {
    createSubmissionHandler,
    getRepositoryClaimsHandler,
    requestRepositoryClaimHandler,
} from '../middleware.ts'
import { claimInput, submitInput } from '../validation.ts'
import { useSubmissionFeedback } from './useSubmissionFeedback.ts'

const initialFields = {
    commit: '',
    path: '.',
    appId: '',
    version: '',
    publisherName: '',
    name: '',
    summary: '',
    license: '',
    configSchema: '',
}
const candidateFields = [
    { name: 'commit', maxLength: 40 },
    { name: 'path', maxLength: 200 },
    { name: 'appId', maxLength: 97 },
    { name: 'version', maxLength: 64 },
    { name: 'publisherName', maxLength: 80 },
    { name: 'name', maxLength: 80 },
    { name: 'summary', maxLength: 400 },
    { name: 'license', maxLength: 64 },
    { name: 'configSchema', maxLength: 240 },
] as const satisfies ReadonlyArray<{
    name: keyof typeof initialFields
    maxLength: number
}>

export function useDeveloperSubmissionsLogic(userId: string) {
    const client = useQueryClient()
    const [repository, setRepository] = useState('')
    const [selectedClaimId, setClaimId] = useState('')
    const [fields, setFields] = useState(initialFields)
    const attempt = useRef<{ fingerprint: string; id: string }>(null)
    const feedback = useSubmissionFeedback()
    const claims = useQuery({
        queryKey: ['marketplace-claims', userId],
        queryFn: ({ signal }) => getRepositoryClaimsHandler({ signal }),
    })
    const selected =
        claims.data?.claims.find((claim) => claim.id === selectedClaimId) ??
        claims.data?.claims[0]
    const claimId = selected?.id ?? ''

    const claimMutation = useMutation({
        mutationFn: async () => {
            const parsed = claimInput.safeParse({
                repository: repository.trim(),
            })
            if (!parsed.success) throw new Error('invalidInput')
            return requestRepositoryClaimHandler({ data: parsed.data })
        },
        onSuccess: async (claim) => {
            setClaimId(claim.id)
            setRepository('')
            await client.invalidateQueries({
                queryKey: ['marketplace-claims', userId],
            })
            feedback.success('claim')
        },
        onError: feedback.error,
    })

    const submissionMutation = useMutation({
        mutationFn: async () => {
            const { name, summary, license, configSchema, ...input } = fields
            const request = {
                ...input,
                claimId,
                commit: input.commit.trim().toLowerCase(),
                display: { name, summary, license },
                configSchema: configSchema.trim() || undefined,
                targets: [...CANDIDATE_PIPELINE.targets],
            }
            const fingerprint = JSON.stringify(request)
            if (attempt.current?.fingerprint !== fingerprint) {
                attempt.current = { fingerprint, id: crypto.randomUUID() }
            }
            const parsed = submitInput.safeParse({
                ...request,
                requestId: attempt.current.id,
            })
            if (!parsed.success) throw new Error('invalidInput')
            return createSubmissionHandler({ data: parsed.data })
        },
        onSuccess: async () => {
            setFields(initialFields)
            attempt.current = null
            await client.invalidateQueries({
                queryKey: ['marketplace-submissions', userId, 'developer'],
            })
            feedback.success('submit')
        },
        onError: feedback.error,
    })

    function submitClaim(event: SubmitEvent<HTMLFormElement>) {
        event.preventDefault()
        if (!claimMutation.isPending) claimMutation.mutate()
    }

    function submitCandidate(event: SubmitEvent<HTMLFormElement>) {
        event.preventDefault()
        if (selected && !submissionMutation.isPending)
            submissionMutation.mutate()
    }

    return {
        state: {
            repository,
            claims,
            claimId,
            selected,
            fields: candidateFields.map(({ name, maxLength }) => ({
                name,
                maxLength,
                value: fields[name],
                required: name !== 'configSchema',
            })),
            claimPending: claimMutation.isPending,
            submitPending: submissionMutation.isPending,
        },
        setter: {
            setRepository,
            setClaimId,
            setField: (name: keyof typeof initialFields, value: string) => {
                setFields((current) => ({ ...current, [name]: value }))
            },
        },
        handler: { submitClaim, submitCandidate },
    }
}
