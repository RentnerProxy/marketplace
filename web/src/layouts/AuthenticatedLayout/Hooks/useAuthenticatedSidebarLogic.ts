import type { AuthenticatedSidebarLogicReturn } from '../Types/authenticated-layout-logic.types.ts'
import { toastAppError } from '@/shared/Errors/toastAppError.ts'
import { toast } from '@rentnerkev/toasts'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { logoutHandler } from '@/features/Auth/middleware.ts'

import useTranslationStore from '@/language/useTranslationStore.ts'
import useAuthenticatedShellUiStore from './useAuthenticatedShellUiStore.ts'
import { resetAppThemeSettings } from '@/lib/Theme/appTheme.ts'
import { clearAuthenticatedQueryCache } from '@/lib/Queries/authenticatedSessionCache.ts'

export default function useAuthenticatedSidebarLogic(): AuthenticatedSidebarLogicReturn {
    const { t } = useTranslationStore()
    const navigate = useNavigate()
    const queryClient = useQueryClient()
    const { state, handler } = useAuthenticatedShellUiStore()

    const logoutMutation = useMutation({
        mutationFn: async function () {
            return await logoutHandler()
        },
        onSuccess: async function () {
            clearAuthenticatedQueryCache(queryClient)
            resetAppThemeSettings()
            toast.success(t('toast.logoutSuccess'), {
                title: t('common.logout'),
            })
            await navigate({ to: '/login' })
        },
        onError: function (error) {
            toastAppError(error)
        },
    })

    function handleLogout() {
        logoutMutation.mutate()
    }

    return {
        state: {
            isCollapsed: state.isCollapsed,
            isLoggingOut: logoutMutation.isPending,
            openGroups: state.openGroups,
        },
        handler: {
            handleLogout,
            handleOpenUserSettings: handler.openUserSettings,
            handleToggleCollapse: handler.toggleCollapse,
            handleToggleGroup: handler.toggleGroup,
        },
    }
}
