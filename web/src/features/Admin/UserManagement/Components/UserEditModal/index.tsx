import type { EditUserModalProps } from '../../Types/user-management-component-props.types.ts'
import Footer from './Components/Footer.tsx'
import GeneralUserInfo from './Components/GeneralUserInfo.tsx'
import Header from './Components/Header.tsx'
import useUserEditModalLogic from './Hooks/useUserEditModalLogic.ts'
import { createPortal } from 'react-dom'

export default function EditUserModal({
    isOpen,
    editForm,
    isUpdatingUser,
    onClose,
    onSubmit,
}: EditUserModalProps) {
    const { state, handler } = useUserEditModalLogic({
        editForm,
        isOpen,
        onSubmit,
    })

    if (!isOpen) {
        return null
    }

    return createPortal(
        <div className="marketplace-signed-in fixed inset-0 z-50 flex items-center justify-center bg-marketplace-void/70 p-2 backdrop-blur-[2px] sm:p-6">
            <div className="marketplace-dialog-panel flex max-h-[calc(100dvh-1rem)] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-border-dark bg-surface-dark text-foreground sm:max-h-[min(44rem,calc(100dvh-3rem))]">
                <Header onClose={onClose} />

                <form
                    className="flex min-h-0 flex-1 flex-col"
                    onSubmit={handler.handleSubmit}
                >
                    <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-5 sm:px-6">
                        <GeneralUserInfo
                            draftForm={state.draftForm}
                            onFieldChange={handler.handleFieldChange}
                        />
                    </div>

                    <Footer isUpdatingUser={isUpdatingUser} onClose={onClose} />
                </form>
            </div>
        </div>,
        document.body,
    )
}
