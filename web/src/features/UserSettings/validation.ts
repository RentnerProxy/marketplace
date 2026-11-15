import {
    USER_FONT_FAMILIES,
    USER_FONT_SIZES,
    USER_THEME_MODES,
} from '@/config/user-theme-colors.config.ts'
import { z } from 'zod'
import {
    imageCropAreaSchema,
    imageDataUrlSchema,
    optionalTextSchema,
    webAuthnResponseSchema,
} from '@/lib/Validation/zodSchemas.ts'
import { authCredentialPasswordSchema } from '@/lib/Auth/validation.ts'

const userPrimaryColorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/)
const userThemeModeSchema = z.enum(USER_THEME_MODES)
const userFontFamilySchema = z.enum(USER_FONT_FAMILIES)
const userBackgroundDarknessSchema = z.number().int().min(0).max(95)
const userFontSizeSchema = z.literal(USER_FONT_SIZES)

export const updateCurrentUserPersonalInfoInputSchema = z.object({
    firstName: optionalTextSchema(100),
    lastName: optionalTextSchema(100),
    street: optionalTextSchema(100),
    houseNumber: optionalTextSchema(20),
    postalCode: optionalTextSchema(20),
    city: optionalTextSchema(100),
})

export const updateCurrentUserProfileImageInputSchema = z.object({
    imageDataUrl: imageDataUrlSchema,
    crop: imageCropAreaSchema,
})

export const updateCurrentUserPrimaryColorInputSchema = z.object({
    primaryColor: userPrimaryColorSchema,
})

export const updateCurrentUserThemeModeInputSchema = z.object({
    themeMode: userThemeModeSchema,
})

export const updateCurrentUserFontFamilyInputSchema = z.object({
    fontFamily: userFontFamilySchema,
})

export const updateCurrentUserFontSizeInputSchema = z.object({
    fontSize: userFontSizeSchema,
})

export const updateCurrentUserBackgroundInputSchema = z.object({
    imageDataUrl: imageDataUrlSchema,
    crop: imageCropAreaSchema,
    customBackgroundDarkness: userBackgroundDarknessSchema.optional(),
})

export const updateCurrentUserBackgroundAppearanceInputSchema = z.object({
    customBackgroundDarkness: userBackgroundDarknessSchema,
})

export const currentUserReauthenticationInputSchema = z.discriminatedUnion(
    'method',
    [
        z.object({
            method: z.literal('password'),
            credential: authCredentialPasswordSchema,
        }),
        z.object({
            method: z.literal('totp'),
            credential: z.string().regex(/^\d{6}$/),
        }),
    ],
)

export const beginCurrentUserTwoFactorSetupInputSchema = z.object({
    reauthentication: currentUserReauthenticationInputSchema,
})

export const confirmCurrentUserTwoFactorSetupInputSchema = z.object({
    setupToken: z.uuid(),
    token: z.string().regex(/^\d{6}$/),
})

export const disableCurrentUserTwoFactorInputSchema = z.object({
    reauthentication: currentUserReauthenticationInputSchema,
})

export const beginCurrentUserPasskeyRegistrationInputSchema = z.object({
    reauthentication: currentUserReauthenticationInputSchema,
})

export const finishCurrentUserPasskeyRegistrationInputSchema = z.object({
    challengeId: z.uuidv7(),
    registrationToken: z.uuid(),
    response: webAuthnResponseSchema,
})

export const deleteCurrentUserPasskeyInputSchema = z.object({
    passkeyId: z.uuidv7(),
    reauthentication: currentUserReauthenticationInputSchema,
})
