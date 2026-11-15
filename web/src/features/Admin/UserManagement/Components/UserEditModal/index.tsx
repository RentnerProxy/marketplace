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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
            <div className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-border-dark bg-surface-dark">
                <Header onClose={onClose} />

                <form
                    className="flex min-h-0 flex-col p-5"
                    onSubmit={handler.handleSubmit}
                >
                    <div className="min-h-0 overflow-y-auto pr-1">
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
