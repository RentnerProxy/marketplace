import { describe, expect, it } from 'bun:test'
import {
    beginCurrentUserPasskeyRegistrationInputSchema,
    beginCurrentUserTwoFactorSetupInputSchema,
    confirmCurrentUserTwoFactorSetupInputSchema,
    currentUserReauthenticationInputSchema,
    deleteCurrentUserPasskeyInputSchema,
    disableCurrentUserTwoFactorInputSchema,
    finishCurrentUserPasskeyRegistrationInputSchema,
    updateCurrentUserBackgroundAppearanceInputSchema,
    updateCurrentUserBackgroundInputSchema,
    updateCurrentUserFontFamilyInputSchema,
    updateCurrentUserFontSizeInputSchema,
    updateCurrentUserPrimaryColorInputSchema,
    updateCurrentUserProfileImageInputSchema,
} from '@/features/UserSettings/validation.ts'

const imageDataUrl = `data:image/png;base64,${Buffer.alloc(128, 0x61).toString('base64')}`
const crop = { x: 10, y: 20, width: 240, height: 200 }
const tokenId = '11111111-1111-4111-8111-111111111111'
const passkeyId = '01941f29-7c00-7000-8000-000000000002'
const challengeId = '01941f29-7c00-7000-8000-000000000001'

describe('UserSettings Validierung', function () {
    it('akzeptiert gültige Profilbild-Daten', function () {
        const result = updateCurrentUserProfileImageInputSchema.safeParse({
            imageDataUrl,
            crop,
        })

        expect(result.success).toBe(true)
    })

    it('akzeptiert gültige Hintergrundbild-Daten', function () {
        const result = updateCurrentUserBackgroundInputSchema.safeParse({
            imageDataUrl,
            crop,
        })

        expect(result.success).toBe(true)
    })

    it.each([0, 55, 95])(
        'akzeptiert %s Prozent Abdunklung beim Hintergrund-Upload',
        function (customBackgroundDarkness) {
            const result = updateCurrentUserBackgroundInputSchema.parse({
                imageDataUrl,
                crop,
                customBackgroundDarkness,
            })

            expect(result.customBackgroundDarkness).toBe(
                customBackgroundDarkness,
            )
        },
    )

    it.each([-1, 96, 55.5, '55', null])(
        'lehnt ungültige Upload-Abdunklung %s ab',
        function (customBackgroundDarkness) {
            expect(
                updateCurrentUserBackgroundInputSchema.safeParse({
                    imageDataUrl,
                    crop,
                    customBackgroundDarkness,
                }).success,
            ).toBe(false)
        },
    )

    it('lehnt ungültige Systemfarben ab', function () {
        const result = updateCurrentUserPrimaryColorInputSchema.safeParse({
            primaryColor: 'rgb(12, 34, 56)',
        })

        expect(result.success).toBe(false)
    })

    it('akzeptiert gültige Hintergrund-Abdunklung', function () {
        const result =
            updateCurrentUserBackgroundAppearanceInputSchema.safeParse({
                customBackgroundDarkness: 55,
            })

        expect(result.success).toBe(true)
    })

    it('akzeptiert gültige Schrift-Einstellungen', function () {
        const fontFamilyResult =
            updateCurrentUserFontFamilyInputSchema.safeParse({
                fontFamily: 'inter',
            })
        const fontSizeResult = updateCurrentUserFontSizeInputSchema.safeParse({
            fontSize: 16,
        })

        expect(fontFamilyResult.success).toBe(true)
        expect(fontSizeResult.success).toBe(true)
    })

    it('lehnt ungültige Schriftgrößen ab', function () {
        const result = updateCurrentUserFontSizeInputSchema.safeParse({
            fontSize: 22,
        })

        expect(result.success).toBe(false)
    })

    it('lehnt ungültige Zwei-Faktor-Codes ab', function () {
        const result = confirmCurrentUserTwoFactorSetupInputSchema.safeParse({
            token: 'abcdef',
            setupToken: tokenId,
        })

        expect(result.success).toBe(false)
    })

    it('trennt Passwort- und TOTP-Bestätigung strikt', function () {
        expect(
            currentUserReauthenticationInputSchema.safeParse({
                method: 'password',
                credential: '1',
            }).success,
        ).toBe(true)
        expect(
            currentUserReauthenticationInputSchema.safeParse({
                method: 'totp',
                credential: '12345a',
            }).success,
        ).toBe(false)
    })

    it('verlangt die erneute Bestätigung für Faktor-Anlage, Entfernen und Deaktivieren', function () {
        expect(
            disableCurrentUserTwoFactorInputSchema.safeParse({}).success,
        ).toBe(false)
        expect(
            beginCurrentUserTwoFactorSetupInputSchema.safeParse({}).success,
        ).toBe(false)
        expect(
            beginCurrentUserTwoFactorSetupInputSchema.safeParse({
                reauthentication: { method: 'password', credential: '1' },
            }).success,
        ).toBe(true)
        expect(
            beginCurrentUserPasskeyRegistrationInputSchema.safeParse({})
                .success,
        ).toBe(false)
        expect(
            beginCurrentUserPasskeyRegistrationInputSchema.safeParse({
                reauthentication: {
                    method: 'password',
                    credential: 'existing-password',
                },
            }).success,
        ).toBe(true)
        expect(
            deleteCurrentUserPasskeyInputSchema.safeParse({
                passkeyId,
            }).success,
        ).toBe(false)
        expect(
            deleteCurrentUserPasskeyInputSchema.safeParse({
                passkeyId,
                reauthentication: {
                    method: 'password',
                    credential: 'existing-password',
                },
            }).success,
        ).toBe(true)
    })

    it('bindet den TOTP-Abschluss an einen Setup-Nachweis', function () {
        expect(
            confirmCurrentUserTwoFactorSetupInputSchema.safeParse({
                token: '123456',
            }).success,
        ).toBe(false)
        expect(
            confirmCurrentUserTwoFactorSetupInputSchema.safeParse({
                token: '123456',
                setupToken: tokenId,
            }).success,
        ).toBe(true)
    })

    it('bindet den Passkey-Abschluss an ein Registrierungstoken', function () {
        const response = {
            id: 'credential-id',
            rawId: 'credential-id',
            response: {},
            clientExtensionResults: {},
            type: 'public-key' as const,
        }

        expect(
            finishCurrentUserPasskeyRegistrationInputSchema.safeParse({
                challengeId,
                response,
            }).success,
        ).toBe(false)
        expect(
            finishCurrentUserPasskeyRegistrationInputSchema.safeParse({
                challengeId,
                registrationToken: tokenId,
                response,
            }).success,
        ).toBe(true)
    })
})
