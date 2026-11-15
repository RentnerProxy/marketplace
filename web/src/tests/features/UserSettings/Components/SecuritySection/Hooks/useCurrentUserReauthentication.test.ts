import { beforeEach, describe, expect, it, vi } from 'bun:test'
import useCurrentUserReauthentication from '@/features/UserSettings/Components/SecuritySection/Hooks/useCurrentUserReauthentication.ts'

const reactState = (function () {
    return {
        value: undefined as string | undefined,
    }
})()

vi.mock('react', function () {
    return {
        useState: function (initialValue: string) {
            reactState.value ??= initialValue

            return [
                reactState.value,
                function (nextValue: string) {
                    reactState.value = nextValue
                },
            ]
        },
    }
})

describe('useCurrentUserReauthentication', function () {
    beforeEach(function () {
        reactState.value = undefined
    })

    it('normalisiert TOTP auf sechs Ziffern und erzeugt den Step-up-Vertrag', function () {
        let logic = useCurrentUserReauthentication({
            isMethodResolved: true,
            isTwoFactorEnabled: true,
        })

        logic.handler.handleReauthenticationValueChange('12a34567')
        logic = useCurrentUserReauthentication({
            isMethodResolved: true,
            isTwoFactorEnabled: true,
        })

        expect(logic.state).toMatchObject({
            isReauthenticationReady: true,
            reauthenticationMethod: 'totp',
            reauthenticationValue: '123456',
        })
        expect(logic.handler.createReauthenticationInput()).toEqual({
            method: 'totp',
            credential: '123456',
        })
    })

    it('begrenzt Passwörter und bleibt ohne aufgelöste Methode gesperrt', function () {
        let logic = useCurrentUserReauthentication({
            isMethodResolved: false,
            isTwoFactorEnabled: false,
        })

        logic.handler.handleReauthenticationValueChange('x'.repeat(1100))
        logic = useCurrentUserReauthentication({
            isMethodResolved: false,
            isTwoFactorEnabled: false,
        })

        expect(logic.state.reauthenticationValue).toHaveLength(1024)
        expect(logic.state.isLoadingReauthenticationMethod).toBe(true)
        expect(logic.state.isReauthenticationReady).toBe(false)

        logic = useCurrentUserReauthentication({
            isMethodResolved: true,
            isTwoFactorEnabled: false,
        })

        expect(logic.state.isReauthenticationReady).toBe(true)
        expect(logic.handler.createReauthenticationInput()).toEqual({
            method: 'password',
            credential: 'x'.repeat(1024),
        })
    })

    it('setzt die Eingabe vollständig zurück', function () {
        let logic = useCurrentUserReauthentication({
            isMethodResolved: true,
            isTwoFactorEnabled: false,
        })
        logic.handler.handleReauthenticationValueChange('password')
        logic = useCurrentUserReauthentication({
            isMethodResolved: true,
            isTwoFactorEnabled: false,
        })

        logic.handler.resetReauthenticationValue()
        logic = useCurrentUserReauthentication({
            isMethodResolved: true,
            isTwoFactorEnabled: false,
        })

        expect(logic.state.reauthenticationValue).toBe('')
        expect(logic.state.isReauthenticationReady).toBe(false)
    })
})
