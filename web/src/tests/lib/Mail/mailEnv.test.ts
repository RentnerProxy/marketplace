import { afterEach, describe, expect, it } from 'bun:test'
import { getNormalizedMailEnv, getRequiredMailEnv } from '@/lib/Mail/mailEnv.ts'

const key = 'TANSTACK_DUMMY_TEST_MAIL_SETTING'
const previous = process.env[key]
afterEach(function () {
    if (previous === undefined) delete process.env[key]
    else process.env[key] = previous
})

describe('mail environment normalization', function () {
    it.each(['', '  ', '\n\t'])(
        'treats blank settings as absent',
        function (value) {
            process.env[key] = value
            expect(getNormalizedMailEnv(key)).toBeNull()
            expect(() => getRequiredMailEnv(key)).toThrow(
                `${key} ist nicht in der Env konfiguriert.`,
            )
        },
    )

    it('handles an absent setting without an SMTP connection', function () {
        delete process.env[key]
        expect(getNormalizedMailEnv(key)).toBeNull()
        expect(() => getRequiredMailEnv(key)).toThrow(key)
    })

    it.each([
        ['  sender@example.test  ', 'sender@example.test'],
        ['" sender@example.test "', 'sender@example.test'],
        ["' sender@example.test '", 'sender@example.test'],
        ['"unterminated', '"unterminated'],
        ['"', '"'],
    ])(
        'normalizes matching quotes while retaining literal unmatched quotes',
        function (value, normalized) {
            process.env[key] = value
            expect(getNormalizedMailEnv(key)).toBe(normalized)
            expect(getRequiredMailEnv(key)).toBe(value.trim())
        },
    )
})
