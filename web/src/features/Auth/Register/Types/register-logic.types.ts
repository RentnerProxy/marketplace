import type { SubmitEvent } from 'react'

export type RegisterLogicReturn = {
    state: {
        username: string
        email: string
        password: string
        confirmPassword: string
        acceptTerms: boolean
        isSocial: boolean
        isPending: boolean
        canVerify: boolean
        error: string
        errorField: 'password' | 'confirmPassword' | 'terms' | null
        phase: 'form' | 'verify' | 'inbox' | 'complete'
    }
    setter: {
        setUsername: (value: string) => void
        setEmail: (value: string) => void
        setPassword: (value: string) => void
        setConfirmPassword: (value: string) => void
        setAcceptTerms: (value: boolean) => void
    }
    handler: {
        handleSubmit: (event: SubmitEvent<HTMLFormElement>) => void
        handleVerify: () => void
        handleCancelSocial: () => void
    }
}
