import { CustomTooltip } from '@rentnerkev/tooltips'
import { LogOut } from 'lucide-react'
import type { LogoutButtonProps } from '../Types/authenticated-layout-component-props.types.ts'
import useAuthenticatedSidebarLogic from '../Hooks/useAuthenticatedSidebarLogic.ts'
import useTranslationStore from '@/language/useTranslationStore.ts'

export default function LogoutButton({ isCollapsed }: LogoutButtonProps) {
    const { state, handler } = useAuthenticatedSidebarLogic()
    const { t } = useTranslationStore()

    return isCollapsed ? (
        <CustomTooltip
            side="right"
            content={t('common.logout')}
            disabledTrigger={state.isLoggingOut}
        >
            <button
                type="button"
                disabled={state.isLoggingOut}
                onClick={handler.handleLogout}
                className="flex h-11 w-full cursor-pointer items-center gap-3 rounded-md px-3 text-sm font-medium text-secondary-text transition-colors hover:bg-input-dark hover:text-danger disabled:cursor-not-allowed disabled:opacity-60"
            >
                <LogOut className="h-5 w-5 shrink-0" />
            </button>
        </CustomTooltip>
    ) : (
        <button
            type="button"
            disabled={state.isLoggingOut}
            onClick={handler.handleLogout}
            className="flex h-11 w-full cursor-pointer items-center gap-3 rounded-md px-3 text-sm font-medium text-secondary-text transition-colors hover:bg-input-dark hover:text-danger disabled:cursor-not-allowed disabled:opacity-60"
        >
            <LogOut className="h-5 w-5 shrink-0" />
            <span>
                {state.isLoggingOut
                    ? t('common.loggingOut')
                    : t('common.logout')}
            </span>
        </button>
    )
}
