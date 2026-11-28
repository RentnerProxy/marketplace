import { useEffect, useRef, useState } from 'react'
import { toast } from '@rentnerkev/toasts'
import type { SubmitEvent } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
    beginSocialLoginHandler,
    cancelSocialAuthHandler,
    finishSocialLoginHandler,
} from '@/features/Auth/Social/middleware.ts'
import type { SocialProviderId } from '@/lib/Auth/Types/social-auth.types.ts'
import type { SocialLoginLogicReturn } from '../Types/social-login.types.ts'
import useSocialAuthState from './useSocialAuthState.ts'
import useTranslationStore from '@/language/useTranslationStore.ts'

export default function useSocialLoginLogic(): SocialLoginLogicReturn {
    const { t } = useTranslationStore()
    const query = useSocialAuthState()
    const { isError, errorUpdatedAt, refetch } = query
    const queryClient = useQueryClient()
    const [code, setCode] = useState('')
    const [error, setError] = useState('')
    const reportedQueryError = useRef<number | null>(null)
    function reportFailure() {
        toast.error(t('auth.social.failed'), {
            title: t('common.error'),
            dedupeKey: 'social-auth-failed',
        })
    }
    useEffect(() => {
        const hash = window.location.hash
        if (!hash.startsWith('#social-error=')) return
        window.history.replaceState(
            window.history.state,
            '',
            window.location.pathname + window.location.search,
        )
        const reason = hash.slice('#social-error='.length)
        const known = [
            'failed',
            'cancelled',
            'account_exists',
            'inactive',
            'expired',
            'link_failed',
        ] as const
        const errorKey =
            reason === 'registration_disabled'
                ? 'auth.register.disabled'
                : (`auth.social.${known.find((entry) => entry === reason) ?? 'failed'}` as const)
        toast.error(t(errorKey), {
            title: t('common.error'),
            dedupeKey: 'social-auth-callback',
        })
    }, [t])
    useEffect(() => {
        if (!isError || reportedQueryError.current === errorUpdatedAt) return
        reportedQueryError.current = errorUpdatedAt
        toast.error(t('auth.social.unavailable'), {
            title: t('common.error'),
            dedupeKey: 'social-auth-unavailable',
            action: {
                label: t('auth.social.retry'),
                onClick: async (id) => {
                    const result = await refetch()
                    if (!result.isError) toast.dismiss(id)
                },
                dismissOnSuccess: false,
            },
        })
    }, [isError, errorUpdatedAt, refetch, t])
    const begin = useMutation({
        meta: { discardAuthSecretsAfterSettled: true },
        mutationFn: (provider: SocialProviderId) =>
            beginSocialLoginHandler({ data: { provider } }),
        onMutate: () => setError(''),
        onSuccess: (result) => window.location.assign(result.url),
        onError: reportFailure,
        onSettled: (): void => begin.reset(),
    })
    const finish = useMutation({
        meta: { discardAuthSecretsAfterSettled: true },
        mutationFn: (twoFactorCode: string) =>
            finishSocialLoginHandler({ data: { twoFactorCode } }),
        onMutate: () => setError(''),
        onSuccess: (result) => {
            if (!result.success) {
                reportFailure()
                return
            }
            queryClient.clear()
            window.location.assign(result.redirectTo)
        },
        onError: reportFailure,
        onSettled: (): void => {
            setCode('')
            finish.reset()
        },
    })
    const cancel = useMutation({
        meta: { discardAuthSecretsAfterSettled: true },
        mutationFn: () => cancelSocialAuthHandler(),
        onSuccess: async () => {
            setCode('')
            setError('')
            await query.refetch()
        },
        onError: reportFailure,
    })
    function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
        event.preventDefault()
        if (!/^\d{6}$/.test(code)) {
            setError(t('auth.login.twoFactorCodeIncomplete'))
            return
        }
        if (!finish.isPending) finish.mutate(code)
    }
    return {
        state: {
            providers: query.data?.providers ?? [],
            isPending: begin.isPending || finish.isPending || cancel.isPending,
            requiresTwoFactor: Boolean(query.data?.requiresTwoFactor),
            code,
            error,
        },
        handler: {
            handleBegin: (provider) => begin.mutate(provider),
            handleSubmit,
            handleCancel: () => cancel.mutate(),
        },
        setter: { setCode },
    }
}
