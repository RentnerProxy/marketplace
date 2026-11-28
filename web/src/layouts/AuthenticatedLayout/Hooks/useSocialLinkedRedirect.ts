import { useEffect } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { toast } from '@rentnerkev/toasts'
import useTranslationStore from '@/language/useTranslationStore.ts'
import { toastAppError } from '@/shared/Errors/toastAppError.ts'

/** After linking a social account, confirm it and open the profile's security tab. */
export default function useSocialLinkedRedirect() {
    const navigate = useNavigate()
    const { t } = useTranslationStore()

    useEffect(() => {
        if (window.location.hash !== '#social-linked') return

        window.history.replaceState(
            window.history.state,
            '',
            `${window.location.pathname}${window.location.search}`,
        )
        toast.success(t('userSettings.security.socialAccounts.linked'), {
            title: t('profile.title'),
        })
        void navigate({ to: '/profile', search: { tab: 'security' } }).catch(
            toastAppError,
        )
    }, [navigate, t])
}
