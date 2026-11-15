import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
    setSystemTime,
    vi,
} from 'bun:test'
import * as OTPAuth from 'otpauth'
import { PROJECT_CONFIG } from '@/config/app.config.ts'
import { TOTP_POLICY } from '@/config/security.config.ts'

let settings: Array<{ companyName: string }> = []
const limit = vi.fn(async (_count: number) => settings)
const from = vi.fn((_table: unknown) => ({ limit }))
const select = vi.fn((_projection: unknown) => ({ from }))
vi.mock('@/db', () => ({ db: { select } }))
vi.mock('@/db/schema.ts', () => ({
    systemSettings: { companyName: 'company-name' },
}))

const { createTotp, createTotpSecret, getTotpCodeStep } =
    await import('@/lib/Auth/totp.ts')
const secret = 'JBSWY3DPEHPK3PXP'
const timestamp = Date.parse('2026-10-01T12:34:56Z')

beforeEach(function () {
    vi.clearAllMocks()
    vi.useFakeTimers()
    setSystemTime(timestamp)
    settings = []
})
afterEach(function () {
    vi.useRealTimers()
    setSystemTime()
})

describe('TOTP setup and accepted time steps', function () {
    it('generates independent 160-bit Base32 setup secrets', function () {
        const first = createTotpSecret()
        const second = createTotpSecret()
        expect(first).toMatch(/^[A-Z2-7]{32}$/)
        expect(second).toMatch(/^[A-Z2-7]{32}$/)
        expect(second).not.toBe(first)
    })

    it('uses trimmed company branding and the configured TOTP algorithm in provisioning', async function () {
        settings = [{ companyName: '  Synthetic Workspace  ' }]
        const totp = await createTotp(secret, 'tester@example.test')
        expect(totp.issuer).toBe('Synthetic Workspace')
        expect(totp.label).toBe('tester@example.test')
        expect(totp.algorithm).toBe(TOTP_POLICY.algorithm)
        expect(totp.digits).toBe(TOTP_POLICY.digits)
        expect(totp.period).toBe(TOTP_POLICY.periodSeconds)
        expect(limit).toHaveBeenCalledWith(1)
    })

    it.each([[], [{ companyName: '  ' }]].map((rows) => ({ rows })))(
        'uses the starter brand when company settings are absent or blank',
        async function ({ rows }) {
            settings = rows
            expect((await createTotp(secret, 'tester')).issuer).toBe(
                PROJECT_CONFIG.defaultName,
            )
        },
    )

    it.each([-1, 0, 1])(
        'returns the accepted counter for a token offset of %s periods',
        function (offset) {
            const generator = new OTPAuth.TOTP({
                secret,
                algorithm: TOTP_POLICY.algorithm,
                digits: TOTP_POLICY.digits,
                period: TOTP_POLICY.periodSeconds,
            })
            const tokenTime =
                timestamp + offset * TOTP_POLICY.periodSeconds * 1000
            const token = generator.generate({ timestamp: tokenTime })
            expect(getTotpCodeStep(secret, token)).toBe(
                generator.counter({ timestamp: tokenTime }),
            )
        },
    )

    it('rejects codes outside the accepted window and malformed input', function () {
        const generator = new OTPAuth.TOTP({
            secret,
            period: TOTP_POLICY.periodSeconds,
        })
        const oldToken = generator.generate({
            timestamp: timestamp - 10 * TOTP_POLICY.periodSeconds * 1000,
        })
        expect(getTotpCodeStep(secret, oldToken)).toBeNull()
        for (const token of [
            '12345',
            '1234567',
            'letters',
            ' 123456',
            '123456\n',
        ]) {
            expect(getTotpCodeStep(secret, token)).toBeNull()
        }
    })
})
