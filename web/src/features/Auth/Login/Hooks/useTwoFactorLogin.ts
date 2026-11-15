import { useRef, useState } from 'react'
import type { SubmitEvent } from 'react'
import { toast } from '@rentnerkev/toasts'
import useTranslationStore from '@/language/useTranslationStore.ts'
import type { SubmitTwoFactorLogin } from '../Types/login-form.types.ts'

const emptyTwoFactorCode = ['', '', '', '', '', '']

export default function useTwoFactorLogin(submitLogin: SubmitTwoFactorLogin) {
    const { t } = useTranslationStore()
    const [requiresTwoFactor, setRequiresTwoFactor] = useState(false)
    const [twoFactorCode, setTwoFactorCode] =
        useState<Array<string>>(emptyTwoFactorCode)
    const [trustThisDevice, setTrustThisDevice] = useState(false)
    const [isTwoFactorError, setIsTwoFactorError] = useState(false)
    const inputRef = useRef<HTMLInputElement | null>(null)

    function showTwoFactorForm(hasError: boolean) {
        setRequiresTwoFactor(true)
        setIsTwoFactorError(hasError && twoFactorCode.join('').length === 6)
        setTimeout(() => inputRef.current?.focus(), 0)
    }

    function handleTwoFactorSubmit(event: SubmitEvent<HTMLFormElement>) {
        event.preventDefault()
        event.stopPropagation()
        const code = twoFactorCode.join('')

        if (code.length !== 6) {
            setIsTwoFactorError(true)
            toast.error(t('auth.login.twoFactorCodeIncomplete'), {
                title: t('common.error'),
            })
            return
        }

        submitLogin({ twoFactorCode: code, trustThisDevice })
    }

    function handleTwoFactorChange(code: Array<string>) {
        setIsTwoFactorError(false)
        setTwoFactorCode(code)
    }

    function handleBackToLogin() {
        setRequiresTwoFactor(false)
        setTwoFactorCode(emptyTwoFactorCode)
        setTrustThisDevice(false)
        setIsTwoFactorError(false)
    }

    function handleTwoFactorRef(element: HTMLInputElement | null) {
        inputRef.current = element
    }

    return {
        state: {
            requiresTwoFactor,
            twoFactorCode,
            trustThisDevice,
            isTwoFactorError,
        },
        setter: { setTrustThisDevice },
        handler: {
            showTwoFactorForm,
            handleTwoFactorSubmit,
            handleTwoFactorChange,
            handleBackToLogin,
            handleTwoFactorRef,
        },
    }
}
