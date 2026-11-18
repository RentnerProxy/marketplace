import { CustomTooltip } from '@rentnerkev/tooltips'
import { LogOut } from 'lucide-react'
import type { LogoutButtonProps } from '../Types/authenticated-layout-component-props.types.ts'
import useAuthenticatedSidebarLogic from '../Hooks/useAuthenticatedSidebarLogic.ts'
import useTranslationStore from '@/language/useTranslationStore.ts'

export default function LogoutButton({ isCollapsed }: LogoutButtonProps) {
    const { state, handler } = useAuthenticatedSidebarLogic()
    const { t } = useTranslationStore()
    const logoutLabel = state.isLoggingOut
        ? t('common.loggingOut')
        : t('common.logout')

    const logoutButton = (
        <button
            type="button"
            disabled={state.isLoggingOut}
            aria-label={isCollapsed ? logoutLabel : undefined}
            onClick={handler.handleLogout}
            className={`flex min-h-12 w-full cursor-pointer items-center rounded-xl border border-[#f87171]/30 bg-[#b91c1c]/15 text-sm font-extrabold text-[#fca5a5] transition-colors enabled:hover:border-[#fca5a5]/50 enabled:hover:bg-[#b91c1c]/25 enabled:hover:text-[#fee2e2] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#fca5a5] disabled:cursor-not-allowed disabled:opacity-55 motion-reduce:transition-none ${
                isCollapsed ? 'justify-center' : 'justify-center gap-2 px-3'
            }`}
        >
            <LogOut aria-hidden="true" className="size-4 shrink-0" />
            {!isCollapsed && <span>{logoutLabel}</span>}
        </button>
    )

    return isCollapsed ? (
        <CustomTooltip
            side="right"
            content={logoutLabel}
            disabledTrigger={state.isLoggingOut}
        >
            {logoutButton}
        </CustomTooltip>
    ) : (
        logoutButton
    )
}
