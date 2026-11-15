import type { LoginRedirectReason } from '@/lib/Routes/Types/route-redirect.types.ts'
import { useEffect, useRef } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { toast } from '@rentnerkev/toasts'
import useTranslationStore from '@/language/useTranslationStore.ts'
import { toastAppError } from '@/shared/Errors/toastAppError.ts'

export default function useLoginRedirectToast(
    redirectReason?: LoginRedirectReason,
) {
    const navigate = useNavigate()
    const { t } = useTranslationStore()
    const hasShownRedirectToast = useRef(false)

    useEffect(() => {
        if (!redirectReason || hasShownRedirectToast.current) {
            return
        }

        hasShownRedirectToast.current = true
        const isMissingToken = redirectReason === 'password-reset-token-missing'

        toast.error(
            t(
                isMissingToken
                    ? 'auth.passwordReset.missingLinkDescription'
                    : 'auth.passwordReset.invalidLinkDescription',
            ),
            {
                title: t(
                    isMissingToken
                        ? 'auth.passwordReset.missingLinkTitle'
                        : 'auth.passwordReset.invalidLinkTitle',
                ),
            },
        )

        void navigate({
            to: '/login',
            hash: '',
            replace: true,
        }).catch(toastAppError)
    }, [navigate, redirectReason, t])
}
