import type {
    CurrentUserReauthenticationOptions,
    CurrentUserReauthenticationReturn,
} from '../Types/reauthentication-logic.types.ts'
import { useState } from 'react'
import type { CurrentUserReauthenticationInput } from '@/features/UserSettings/Types/user-settings-server-input.types.ts'

export default function useCurrentUserReauthentication({
    isMethodResolved,
    isTwoFactorEnabled,
}: CurrentUserReauthenticationOptions): CurrentUserReauthenticationReturn {
    const [reauthenticationValue, setReauthenticationValue] = useState('')
    const reauthenticationMethod = isTwoFactorEnabled ? 'totp' : 'password'
    const isReauthenticationReady =
        isMethodResolved &&
        (reauthenticationMethod === 'totp'
            ? /^\d{6}$/.test(reauthenticationValue)
            : reauthenticationValue.length > 0)

    function handleReauthenticationValueChange(value: string) {
        setReauthenticationValue(
            reauthenticationMethod === 'totp'
                ? value.replace(/\D/g, '').slice(0, 6)
                : value.slice(0, 1024),
        )
    }

    function resetReauthenticationValue() {
        setReauthenticationValue('')
    }

    function createReauthenticationInput(): CurrentUserReauthenticationInput {
        return {
            method: reauthenticationMethod,
            credential: reauthenticationValue,
        }
    }

    return {
        handler: {
            createReauthenticationInput,
            handleReauthenticationValueChange,
            resetReauthenticationValue,
        },
        state: {
            isLoadingReauthenticationMethod: !isMethodResolved,
            isReauthenticationReady,
            reauthenticationMethod,
            reauthenticationValue,
        },
    }
}
