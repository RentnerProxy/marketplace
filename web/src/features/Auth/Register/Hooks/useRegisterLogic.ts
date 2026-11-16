import { useEffect, useRef, useState } from 'react'
import type { SubmitEvent } from 'react'
import { useMutation } from '@tanstack/react-query'
import { toast } from '@rentnerkev/toasts'
import { REGISTRATION_POLICY } from '@/config/security.config.ts'
import { registerHandler, verifyRegistrationHandler } from '../middleware.ts'
import { cancelSocialAuthHandler } from '@/features/Auth/Social/middleware.ts'
import useSocialAuthState from '@/shared/Auth/Hooks/useSocialAuthState.ts'
import useTranslationStore from '@/language/useTranslationStore.ts'
import type { RegisterLogicReturn } from '../Types/register-logic.types.ts'

export default function useRegisterLogic(): RegisterLogicReturn {
    const { t } = useTranslationStore()
    const social = useSocialAuthState()
    const [username, setUsername] = useState('')
    const [emailDraft, setEmail] = useState<string | null>(null)
    const [password, setPassword] = useState('')
    const [confirmPassword, setConfirmPassword] = useState('')
    const [acceptTerms, setAcceptTerms] = useState(false)
    const [error, setError] = useState('')
    const [errorField, setErrorField] =
        useState<RegisterLogicReturn['state']['errorField']>(null)
    const [canVerify, setCanVerify] = useState(false)
    const [phase, setPhase] =
        useState<RegisterLogicReturn['state']['phase']>('form')
    const token = useRef<string | null>(null)
    const verificationInFlight = useRef(false)
    const isSocial = Boolean(social.data?.registration)
    const email = emailDraft ?? social.data?.registration?.email ?? ''
    function reportError(key: string) {
        toast.error(t(key), {
            title: t('common.error'),
            dedupeKey: `registration:${key}`,
        })
    }
    useEffect(() => {
        const hash = window.location.hash
        if (!hash.startsWith('#verify=')) return
        window.history.replaceState(
            window.history.state,
            '',
            window.location.pathname + window.location.search,
        )
        const candidate = hash.slice('#verify='.length)
        const valid = /^[A-Za-z0-9_-]{43}$/.test(candidate)
        if (valid) token.current = candidate
        queueMicrotask(() => {
            setPhase('verify')
            setCanVerify(valid)
        })
        if (!valid)
            toast.error(t('auth.register.invalidVerification'), {
                title: t('common.error'),
                dedupeKey: 'registration:auth.register.invalidVerification',
            })
    }, [t])
    const registration = useMutation({
        meta: { discardAuthSecretsAfterSettled: true },
        mutationFn: (data: {
            username: string
            email: string
            password?: string
            acceptTerms: true
        }) => registerHandler({ data }),
        onMutate: () => {
            setError('')
            setErrorField(null)
        },
        onSuccess: (result) => {
            if (!result.success) {
                reportError(
                    result.error === 'registration.passwordRequired'
                        ? 'auth.register.passwordPolicy'
                        : 'auth.register.failed',
                )
                return
            }
            setPassword('')
            setConfirmPassword('')
            if (result.redirectTo && result.redirectTo !== '/login') {
                window.location.assign(result.redirectTo)
                return
            }
            setPhase(result.requiresEmailVerification ? 'inbox' : 'complete')
            toast.success(
                t(
                    result.requiresEmailVerification
                        ? 'auth.register.checkInbox'
                        : 'auth.register.complete',
                ),
                { title: t('auth.register.title') },
            )
        },
        onError: () => reportError('auth.register.failed'),
        onSettled: (): void => registration.reset(),
    })
    const verification = useMutation({
        meta: { discardAuthSecretsAfterSettled: true },
        mutationFn: async () => {
            if (!token.current) throw new Error('missing')
            return verifyRegistrationHandler({ data: { token: token.current } })
        },
        onMutate: () => {
            setError('')
            setErrorField(null)
        },
        onSuccess: (result) => {
            if (!result.success) {
                reportError('auth.register.invalidVerification')
                return
            }
            token.current = null
            setCanVerify(false)
            setPhase('complete')
            toast.success(t('auth.register.complete'), {
                title: t('auth.register.title'),
            })
        },
        onError: () => reportError('auth.register.verificationFailed'),
        onSettled: (): void => {
            verificationInFlight.current = false
            verification.reset()
        },
    })
    const cancellation = useMutation({
        meta: { discardAuthSecretsAfterSettled: true },
        mutationFn: () => cancelSocialAuthHandler(),
        onSuccess: async () => {
            setEmail(null)
            await social.refetch()
        },
        onError: () => reportError('auth.social.failed'),
    })
    function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
        event.preventDefault()
        if (registration.isPending || social.isPending) return
        if (!acceptTerms) {
            setErrorField('terms')
            setError(t('auth.register.termsRequired'))
            return
        }
        if (
            !isSocial &&
            password.length < REGISTRATION_POLICY.minimumPasswordLength
        ) {
            setErrorField('password')
            setError(t('auth.register.passwordPolicy'))
            return
        }
        if (!isSocial && password !== confirmPassword) {
            setErrorField('confirmPassword')
            setError(t('auth.register.passwordMismatch'))
            return
        }
        registration.mutate({
            username: username.trim(),
            email: email.trim(),
            ...(isSocial ? {} : { password }),
            acceptTerms: true,
        })
    }
    return {
        state: {
            username,
            email,
            password,
            confirmPassword,
            acceptTerms,
            isSocial,
            canVerify,
            isPending:
                registration.isPending ||
                verification.isPending ||
                cancellation.isPending ||
                social.isPending,
            error,
            errorField,
            phase,
        },
        setter: {
            setUsername,
            setEmail,
            setPassword,
            setConfirmPassword,
            setAcceptTerms,
        },
        handler: {
            handleSubmit,
            handleVerify: () => {
                if (token.current && !verificationInFlight.current) {
                    verificationInFlight.current = true
                    verification.mutate()
                }
            },
            handleCancelSocial: () => cancellation.mutate(),
        },
    }
}
