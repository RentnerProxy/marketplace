import { X } from 'lucide-react'
import useTranslationStore from '@/language/useTranslationStore.ts'
import useModalDialogLogic from '@/shared/Hooks/useModalDialogLogic.ts'
import { SidebarContent } from './AuthenticatedSidebar.tsx'
import type { MobileNavigationProps } from '../Types/authenticated-layout-component-props.types.ts'

export default function MobileNavigation({
    isOpen,
    onClose,
    sidebar,
}: MobileNavigationProps) {
    const { t } = useTranslationStore()
    const {
        state,
        handler,
        refs: { dialogRef, closeButtonRef },
    } = useModalDialogLogic({ isOpen, closeDisabled: false, onClose })

    return (
        <dialog
            id="marketplace-mobile-navigation"
            aria-labelledby="marketplace-mobile-navigation-title"
            aria-modal="true"
            ref={dialogRef}
            onCancel={handler.handleCancel}
            className="marketplace-sidebar-texture fixed inset-y-0 left-0 m-0 h-dvh max-h-none w-[min(24rem,calc(100%-1rem))] max-w-none flex-col overflow-hidden border-r-2 border-primary text-[#f4f5f7] shadow-2xl shadow-black/40 open:flex backdrop:bg-background-dark/75"
        >
            {state.shouldRender && (
                <>
                    <div className="flex shrink-0 items-center justify-between gap-4 border-b border-white/10 px-5 py-3">
                        <h2
                            id="marketplace-mobile-navigation-title"
                            className="font-(family-name:--marketplace-mono) text-xs font-bold tracking-widest text-white/75 uppercase"
                        >
                            {t('nav.navigation')}
                        </h2>
                        <button
                            ref={closeButtonRef}
                            type="button"
                            aria-label={t('nav.collapse')}
                            onClick={onClose}
                            className="grid size-10 shrink-0 cursor-pointer place-items-center rounded-full border border-primary/40 bg-primary/10 text-(color:--color-primary) transition-colors hover:border-primary hover:bg-primary/20 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary motion-reduce:transition-none"
                        >
                            <X aria-hidden="true" className="size-5" />
                        </button>
                    </div>
                    <SidebarContent {...sidebar} onNavigate={onClose} />
                </>
            )}
        </dialog>
    )
}
