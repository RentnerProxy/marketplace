import { LogOut } from 'lucide-react'
import useAuthenticatedSidebarLogic from '../Hooks/useAuthenticatedSidebarLogic.ts'
import useTranslationStore from '@/language/useTranslationStore.ts'

export default function LogoutButton() {
    const { state, handler } = useAuthenticatedSidebarLogic()
    const { t } = useTranslationStore()
    const logoutLabel = state.isLoggingOut
        ? t('common.loggingOut')
        : t('common.logout')

    return (
        <button
            type="button"
            disabled={state.isLoggingOut}
            onClick={handler.handleLogout}
            className="comic-lettering comic-focus flex h-11 w-full cursor-pointer items-center gap-3 rounded-md px-3 text-sm text-mist-300 transition-colors hover:bg-white/10 hover:text-[#fca5a5] disabled:cursor-not-allowed disabled:opacity-60 motion-reduce:transition-none"
        >
            <LogOut aria-hidden="true" className="size-4 shrink-0" />
            <span>{logoutLabel}</span>
        </button>
    )
}
