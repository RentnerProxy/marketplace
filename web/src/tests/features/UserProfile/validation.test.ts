import { describe, expect, it } from 'bun:test'
import { userProfileSearchSchema } from '@/features/UserProfile/validation.ts'
import { updateCurrentUserBioInputSchema } from '@/features/UserSettings/validation.ts'

describe('profile validation', () => {
    it('accepts known tabs and drops unknown ones', () => {
        expect(userProfileSearchSchema.parse({ tab: 'security' })).toEqual({
            tab: 'security',
        })
        expect(userProfileSearchSchema.parse({ tab: 'admin' })).toEqual({
            tab: undefined,
        })
        expect(userProfileSearchSchema.parse({})).toEqual({})
    })

    it('trims the bio and enforces its maximum length', () => {
        expect(
            updateCurrentUserBioInputSchema.parse({ bio: '  Hi  ' }),
        ).toEqual({
            bio: 'Hi',
        })
        expect(updateCurrentUserBioInputSchema.parse({})).toEqual({ bio: '' })
        expect(
            updateCurrentUserBioInputSchema.safeParse({ bio: 'x'.repeat(281) })
                .success,
        ).toBe(false)
    })
})
