import { useEffect, useRef, useState } from 'react'
import type { SubmitEvent } from 'react'
import useTranslationStore from '@/language/useTranslationStore.ts'
import { staffInvitationTokenHandoff } from '@/lib/Auth/staffInvitationToken.ts'
import { acceptStaffInvitationHandler } from '../middleware.ts'
import type {
    StaffInvitationLogic,
    StaffInvitationPhase,
} from '../Types/staff-invitation-logic.types.ts'

export default function useStaffInvitationLogic(): StaffInvitationLogic {
    const { t } = useTranslationStore()
    const token = useRef<string | null>(null)
    const submitting = useRef(false)
    const [phase, setPhase] = useState<StaffInvitationPhase>('checking')
    const [password, setPassword] = useState('')
    const [confirmPassword, setConfirmPassword] = useState('')
    const [isSubmitting, setIsSubmitting] = useState(false)
    const [error, setError] = useState<string | null>(null)

    useEffect(() => {
        const handoff = staffInvitationTokenHandoff.get(window)
        let disposed = false
        function receiveToken() {
            const next = handoff?.take()
            token.current = next?.status === 'captured' ? next.token : null
            setPassword('')
            setConfirmPassword('')
            setError(null)
            setPhase(token.current ? 'form' : 'invalid')
        }

        // Defer the first read so a Strict Mode effect replay cannot consume the token.
        queueMicrotask(() => {
            if (!disposed) receiveToken()
        })
        const unsubscribe = handoff?.subscribe(receiveToken)
        return () => {
            disposed = true
            token.current = null
            unsubscribe?.()
        }
    }, [])

    async function submit(currentToken: string) {
        submitting.current = true
        setIsSubmitting(true)
        setError(null)
        try {
            const result = await acceptStaffInvitationHandler({
                data: { token: currentToken, password },
            })
            if (token.current !== currentToken) return
            if ('unavailable' in result) {
                setError(t('auth.staffInvitation.failed'))
                return
            }
            token.current = null
            setPassword('')
            setConfirmPassword('')
            setPhase(result.success ? 'complete' : 'invalid')
        } catch {
            if (token.current === currentToken)
                setError(t('auth.staffInvitation.failed'))
        } finally {
            submitting.current = false
            setIsSubmitting(false)
        }
    }

    function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
        event.preventDefault()
        if (!token.current || submitting.current) return
        if (password !== confirmPassword) {
            setError(t('auth.register.passwordMismatch'))
            return
        }
        void submit(token.current)
    }

    return {
        state: { phase, password, confirmPassword, isSubmitting, error },
        setter: { setPassword, setConfirmPassword },
        handler: { handleSubmit },
    }
}
