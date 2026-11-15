import { beforeEach, describe, expect, it, vi } from 'bun:test'
import type { UserSessionsRevokedEvent } from '@/websockets/Types/events.ts'

const publish = vi.fn(async function (
    _input: UserSessionsRevokedEvent['payload'],
) {})
const log = vi.fn(function (..._args: Array<unknown>) {})
vi.mock('@/server/Realtime/publish.service.ts', () => ({
    publishUserSessionsRevokedService: publish,
}))
vi.mock('@/server/Logging/logger.ts', () => ({ logError: log }))

const { publishCommittedFactorSessionRevocationService } =
    await import('@/server/Auth/factor-session-revocation.service.ts')
const input = {
    userId: '0197f495-622c-70ad-9fd4-11edce58c001',
    auditReceipt: {
        id: '0197f495-622c-70ad-9fd4-11edce58c002',
        createdAt: new Date('2026-09-06T01:02:03.456Z'),
    },
}

beforeEach(() => {
    publish.mockReset().mockResolvedValue(undefined)
    log.mockReset().mockReturnValue(undefined)
})

describe('committed factor session revocation', () => {
    it('publishes once with the existing bounded payload and committed audit time', async () => {
        await expect(
            publishCommittedFactorSessionRevocationService(input),
        ).resolves.toBeUndefined()
        expect(publish.mock.calls).toEqual([
            [{ userId: input.userId, revokedAt: '2026-09-06T01:02:03.456Z' }],
        ])
        expect(log).not.toHaveBeenCalled()
    })

    it.each(['reject', 'throw'] as const)(
        'contains publisher %s without retrying or changing committed success',
        async (failureMode) => {
            const failure = new Error('Synthetic private transport details')
            if (failureMode === 'reject') publish.mockRejectedValueOnce(failure)
            else
                publish.mockImplementationOnce(() => {
                    throw failure
                })
            await expect(
                publishCommittedFactorSessionRevocationService(input),
            ).resolves.toBeUndefined()
            expect(publish).toHaveBeenCalledTimes(1)
            expect(log.mock.calls).toEqual([
                [
                    'auth.factor_change.realtime_revoke_failed',
                    failure,
                    { auditLogId: input.auditReceipt.id },
                ],
            ])
        },
    )

    it('contains an independent logging failure after publication failure', async () => {
        publish.mockRejectedValueOnce(new Error('Synthetic publisher failure'))
        log.mockImplementationOnce(() => {
            throw new Error('Synthetic logger failure')
        })
        await expect(
            publishCommittedFactorSessionRevocationService(input),
        ).resolves.toBeUndefined()
        expect(publish).toHaveBeenCalledTimes(1)
        expect(log).toHaveBeenCalledTimes(1)
    })

    it('contains timestamp serialization errors without attempting publication', async () => {
        await expect(
            publishCommittedFactorSessionRevocationService({
                ...input,
                auditReceipt: {
                    ...input.auditReceipt,
                    createdAt: new Date(Number.NaN),
                },
            }),
        ).resolves.toBeUndefined()
        expect(publish).not.toHaveBeenCalled()
        expect(log).toHaveBeenCalledTimes(1)
    })
})
