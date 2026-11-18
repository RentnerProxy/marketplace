import { useState, type SubmitEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { getOfficialAppsHandler, setOfficialAppHandler } from '../middleware.ts'
import { officialAppInput } from '../validation.ts'
import { useSubmissionFeedback } from './useSubmissionFeedback.ts'

export function useOfficialAppsLogic(userId: string) {
    const [appId, setAppId] = useState('')
    const [claimId, setClaimId] = useState('')
    const [revision, setRevision] = useState(0)
    const client = useQueryClient()
    const key = ['marketplace-official-apps', userId]
    const feedback = useSubmissionFeedback()
    const apps = useQuery({
        queryKey: key,
        queryFn: ({ signal }) => getOfficialAppsHandler({ signal }),
    })
    const mutation = useMutation({
        mutationFn: async (remove: boolean) => {
            const input = officialAppInput.safeParse({
                appId: appId.trim(),
                claimId: remove ? null : claimId.trim(),
                revision,
            })
            if (!input.success) throw new Error('invalidInput')
            return setOfficialAppHandler({ data: input.data })
        },
        onSuccess: async (changed) => {
            select(changed)
            await client.invalidateQueries({ queryKey: key })
            feedback.success('namespace')
        },
        onError: async (error) => {
            feedback.error(error)
            await apps.refetch()
        },
    })

    function select(entry: {
        appId: string
        claimId: string | null
        revision: number
    }) {
        setAppId(entry.appId)
        setClaimId(entry.claimId ?? '')
        setRevision(entry.revision)
    }

    function submit(event: SubmitEvent<HTMLFormElement>) {
        event.preventDefault()
        if (!mutation.isPending)
            mutation.mutate(
                event.nativeEvent.submitter?.getAttribute('value') === 'remove',
            )
    }

    return {
        state: { apps, appId, claimId, revision, pending: mutation.isPending },
        setter: {
            setClaimId,
            setAppId: (value: string) => {
                setAppId(value)
                setRevision(0)
            },
        },
        handler: { select, submit },
    }
}
