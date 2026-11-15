import { faker } from '@faker-js/faker'
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
    updateCurrentUserPersonalInfoInputSchema,
    updateCurrentUserPrimaryColorInputSchema,
    updateCurrentUserProfileImageInputSchema,
} from '@/features/UserSettings/validation.ts'

function createImageDataUrl() {
    return `data:image/png;base64,${Buffer.from(
        faker.string.alphanumeric(128),
    ).toString('base64')}`
}

function createCropArea() {
    return {
        x: faker.number.int({ min: 0, max: 20 }),
        y: faker.number.int({ min: 0, max: 20 }),
        width: faker.number.int({ min: 50, max: 512 }),
        height: faker.number.int({ min: 50, max: 512 }),
    }
}

describe('UserSettings Validierung', function () {
    it('akzeptiert gültige persönliche Daten', function () {
        const result = updateCurrentUserPersonalInfoInputSchema.safeParse({
            firstName: faker.person.firstName(),
            lastName: faker.person.lastName(),
            street: faker.location.street(),
            houseNumber: faker.location.buildingNumber(),
            postalCode: faker.location.zipCode(),
            city: faker.location.city(),
        })

        expect(result.success).toBe(true)
    })

    it('akzeptiert gültige Profilbild-Daten', function () {
        const result = updateCurrentUserProfileImageInputSchema.safeParse({
            imageDataUrl: createImageDataUrl(),
            crop: createCropArea(),
        })

        expect(result.success).toBe(true)
    })

    it('akzeptiert gültige Hintergrundbild-Daten', function () {
        const result = updateCurrentUserBackgroundInputSchema.safeParse({
            imageDataUrl: createImageDataUrl(),
            crop: createCropArea(),
        })

        expect(result.success).toBe(true)
    })

    it.each([0, 55, 95])(
        'akzeptiert %s Prozent Abdunklung beim Hintergrund-Upload',
        function (customBackgroundDarkness) {
            const result = updateCurrentUserBackgroundInputSchema.parse({
                imageDataUrl: createImageDataUrl(),
                crop: createCropArea(),
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
                    imageDataUrl: createImageDataUrl(),
                    crop: createCropArea(),
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
                customBackgroundDarkness: faker.number.int({
                    min: 0,
                    max: 95,
                }),
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
            token: faker.string.alpha(6),
            setupToken: faker.string.uuid(),
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
                passkeyId: faker.string.uuid(),
            }).success,
        ).toBe(false)
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
                setupToken: faker.string.uuid(),
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
                challengeId: Bun.randomUUIDv7(),
                response,
            }).success,
        ).toBe(false)
        expect(
            finishCurrentUserPasskeyRegistrationInputSchema.safeParse({
                challengeId: Bun.randomUUIDv7(),
                registrationToken: faker.string.uuid(),
                response,
            }).success,
        ).toBe(true)
    })
})
