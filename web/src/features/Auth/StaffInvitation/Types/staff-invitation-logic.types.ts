import type { SubmitEvent } from 'react'

export type StaffInvitationPhase = 'checking' | 'form' | 'invalid' | 'complete'

export type StaffInvitationLogic = {
    state: {
        phase: StaffInvitationPhase
        password: string
        confirmPassword: string
        isSubmitting: boolean
        error: string | null
    }
    setter: {
        setPassword: (value: string) => void
        setConfirmPassword: (value: string) => void
    }
    handler: { handleSubmit: (event: SubmitEvent<HTMLFormElement>) => void }
}
