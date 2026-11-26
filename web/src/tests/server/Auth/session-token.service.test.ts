import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
    setSystemTime,
    vi,
} from 'bun:test'
import { Buffer } from 'node:buffer'
import { createTokenHash } from '@/lib/Auth/tokens.ts'
import { sessionConfig } from '@/config/session.config.ts'
import {
    createSessionTokenService,
    getSessionTokenCandidateService,
    parseSessionTokenService,
} from '@/server/Auth/session-token.service.ts'

const NOW = Date.parse('2026-09-06T03:00:00.000Z')
const ENTROPY = Buffer.alloc(32, 7).toString('base64url')
function syntheticToken(issuedAt = NOW) {
    return 's1.' + issuedAt + '.' + ENTROPY
}

beforeEach(function () {
    setSystemTime(NOW)
})
afterEach(function () {
    vi.restoreAllMocks()
    setSystemTime()
})

describe('bounded authenticated session token', function () {
    it('creates separate idle and absolute deadlines and hashes the entire opaque token', async function () {
        const session = await createSessionTokenService()
        expect(session.expiresAt.getTime()).toBe(NOW + 15 * 60_000)
        expect(session.absoluteExpiresAt.getTime()).toBe(NOW + 8 * 60 * 60_000)
        expect(session.hash).toBe(await createTokenHash(session.token))
        expect(session.hash).toMatch(/^[a-f0-9]{64}$/)
        const parsed = parseSessionTokenService(session.token)
        expect(parsed?.issuedAtMs).toBe(NOW)
        expect(parsed?.absoluteExpiresAt).toEqual(session.absoluteExpiresAt)
        const encodedEntropy = session.token.split('.')[2]
        expect(Buffer.from(encodedEntropy, 'base64url')).toHaveLength(32)
        expect(encodedEntropy).toHaveLength(43)
        expect(await getSessionTokenCandidateService(session.token)).toEqual({
            sessionHash: session.hash,
            issuedAtMs: NOW,
            absoluteExpiresAt: session.absoluteExpiresAt,
        })
    })

    it('issues independently random tokens even when all logins have the same millisecond', async function () {
        const tokens = await Promise.all(
            Array.from({ length: 32 }, () => createSessionTokenService()),
        )
        expect(new Set(tokens.map((value) => value.token)).size).toBe(32)
        expect(new Set(tokens.map((value) => value.hash)).size).toBe(32)
    })

    it('changes the database lookup hash when the authenticated issue time is changed', async function () {
        const first = await getSessionTokenCandidateService(
            syntheticToken(NOW - 1),
        )
        const second = await getSessionTokenCandidateService(
            syntheticToken(NOW),
        )
        expect(first?.sessionHash).not.toBe(second?.sessionHash)
        expect(first?.sessionHash).toBe(
            await createTokenHash(syntheticToken(NOW - 1)),
        )
        expect(second?.sessionHash).toBe(
            await createTokenHash(syntheticToken(NOW)),
        )
    })

    it.each([
        { label: 'missing', value: undefined },
        { label: 'null', value: null },
        { label: 'number', value: NOW },
        { label: 'object', value: { toString: () => syntheticToken() } },
        { label: 'legacy UUID', value: '11111111-1111-4111-8111-111111111111' },
        {
            label: 'unsupported version',
            value: syntheticToken().replace('s1.', 's2.'),
        },
        { label: 'negative issue time', value: 's1.-1.' + ENTROPY },
        { label: 'zero issue time', value: 's1.0.' + ENTROPY },
        { label: 'decimal issue time', value: 's1.1.5.' + ENTROPY },
        { label: 'exponent time', value: 's1.1e12.' + ENTROPY },
        {
            label: 'noncanonical leading zero',
            value: 's1.0' + NOW + '.' + ENTROPY,
        },
        {
            label: 'newline in issue time',
            value: 's1.' + NOW + '\n.' + ENTROPY,
        },
        { label: 'future issue time', value: syntheticToken(NOW + 1) },
        {
            label: 'expired exactly at absolute deadline',
            value: syntheticToken(NOW - sessionConfig.absoluteDurationMs),
        },
        {
            label: 'expired past absolute deadline',
            value: syntheticToken(NOW - sessionConfig.absoluteDurationMs - 1),
        },
        { label: 'oversized', value: syntheticToken() + 'A'.repeat(1000) },
        { label: 'extra component', value: syntheticToken() + '.extra' },
        { label: 'base64 padding', value: syntheticToken() + '=' },
        { label: 'short entropy', value: 's1.' + NOW + '.' + ENTROPY.slice(1) },
        { label: 'long entropy', value: 's1.' + NOW + '.' + ENTROPY + 'A' },
        {
            label: 'noncanonical base64 trailing bits',
            value: 's1.' + NOW + '.' + ENTROPY.slice(0, -1) + 'd',
        },
        { label: 'terminal newline', value: syntheticToken() + '\n' },
        { label: 'whitespace', value: ' ' + syntheticToken() },
    ])(
        'rejects $label before a database lookup candidate exists',
        async function ({ value }) {
            expect(parseSessionTokenService(value)).toBeNull()
            expect(await getSessionTokenCandidateService(value)).toBeNull()
        },
    )

    it('accepts the last millisecond before the fixed absolute deadline', function () {
        expect(
            parseSessionTokenService(
                syntheticToken(NOW - sessionConfig.absoluteDurationMs + 1),
            )?.absoluteExpiresAt.getTime(),
        ).toBe(NOW + 1)
    })

    it.each([NaN, Infinity, -Infinity, 0, -1, 1.5, Number.MAX_SAFE_INTEGER])(
        'fails closed for an invalid clock %s',
        async function (value) {
            expect(parseSessionTokenService(syntheticToken(), value)).toBeNull()
            await expect(createSessionTokenService(value)).rejects.toThrow(
                'Invalid session issue time.',
            )
        },
    )

    it('rechecks the absolute deadline before accepting the hashed token', async function () {
        const candidate = getSessionTokenCandidateService(syntheticToken())
        setSystemTime(NOW + sessionConfig.absoluteDurationMs)
        expect(await candidate).toBeNull()
    })

    it('rejects a clock moved before the issue time while validating a token', async function () {
        const candidate = getSessionTokenCandidateService(syntheticToken())
        setSystemTime(NOW - 1)
        expect(await candidate).toBeNull()
    })
})
