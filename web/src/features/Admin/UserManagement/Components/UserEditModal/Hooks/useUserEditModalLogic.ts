import type { SubmitEvent } from 'react'
import { useState } from 'react'
import type {
    UserEditModalLogicParams,
    UserEditModalLogicReturn,
} from '../Types/user-edit-modal-logic.types.ts'

export default function useUserEditModalLogic({
    editForm,
    isOpen,
    onSubmit,
}: UserEditModalLogicParams): UserEditModalLogicReturn {
    const [draftForm, setDraftForm] = useState(editForm)
    const draftSource = isOpen ? editForm : null
    const [previousDraftSource, setPreviousDraftSource] = useState(draftSource)

    if (draftSource !== previousDraftSource) {
        setPreviousDraftSource(draftSource)

        if (draftSource) {
            setDraftForm(draftSource)
        }
    }

    const handleFieldChange: UserEditModalLogicReturn['handler']['handleFieldChange'] =
        function (key, value) {
            setDraftForm(function (current) {
                return {
                    ...current,
                    [key]: value,
                }
            })
        }

    function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
        event.preventDefault()
        onSubmit(draftForm)
    }

    return {
        state: {
            draftForm,
        },
        handler: {
            handleFieldChange,
            handleSubmit,
        },
    }
}
