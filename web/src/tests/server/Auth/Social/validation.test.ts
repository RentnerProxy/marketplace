import { describe, expect, it } from 'bun:test'
import { socialIdentitySchema, socialProviderSchema } from '@/server/Auth/Social/validation.ts'

describe('Social provider boundaries', () => {
    it.each(['apple', 'facebook', 'microsoft'])('rejects removed provider %s in callbacks and persisted identity payloads', (provider) => {
        expect(socialProviderSchema.safeParse(provider).success).toBe(false)
        expect(socialIdentitySchema.safeParse({ provider, subject: 'provider-subject', email: 'member@example.test', emailVerified: true }).success).toBe(false)
    })
})
