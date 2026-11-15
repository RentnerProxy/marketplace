import { beforeEach, describe, expect, it, vi } from 'bun:test'
import { notifyCommittedSecurityChangeService } from '@/server/Auth/security-change-notification.service.ts'
import type { SecurityChangeMailInput } from '@/lib/Mail/Types/mail-domain.types.ts'

const enqueue = vi.fn(async function (_input: SecurityChangeMailInput) {})
const log = vi.fn(function (..._args: Array<unknown>) {})
vi.mock('@/server/Queues/mail.queue.ts', () => ({
    enqueueSecurityChangeMail: enqueue,
}))
vi.mock('@/server/Logging/logger.ts', () => ({ logError: log }))

const receipt = {
    id: '0197f495-622c-70ad-9fd4-11edce58c001',
    createdAt: new Date('2026-09-06T01:02:03.456Z'),
}
beforeEach(() => {
    enqueue.mockReset().mockResolvedValue(undefined)
    log.mockReset().mockReturnValue(undefined)
})

describe('committed security-change notification', () => {
    it.each([
        'password_changed',
        'totp_enabled',
        'totp_disabled',
        'passkey_added',
        'passkey_removed',
    ] as const)(
        'queues %s exactly once with the committed audit timestamp and no credential context',
        async (change) => {
            await expect(
                notifyCommittedSecurityChangeService({
                    to: 'previous-contact@example.test',
                    change,
                    auditReceipt: receipt,
                }),
            ).resolves.toBeUndefined()
            expect(enqueue.mock.calls).toEqual([
                [
                    {
                        to: 'previous-contact@example.test',
                        change,
                        changedAt: '2026-09-06T01:02:03.456Z',
                        auditEventId: receipt.id,
                    },
                ],
            ])
            expect(log).not.toHaveBeenCalled()
        },
    )

    it('does not propagate or retry a failed enqueue', async () => {
        const failure = new Error('synthetic private delivery failure')
        enqueue.mockRejectedValueOnce(failure)
        await expect(
            notifyCommittedSecurityChangeService({
                to: 'previous-contact@example.test',
                change: 'password_changed',
                auditReceipt: receipt,
            }),
        ).resolves.toBeUndefined()
        expect(enqueue).toHaveBeenCalledTimes(1)
        expect(log.mock.calls).toEqual([
            [
                'auth.security_change_notification.failed',
                failure,
                { auditLogId: receipt.id },
            ],
        ])
    })

    it('contains a logger failure after a queue failure', async () => {
        enqueue.mockRejectedValueOnce(new Error('synthetic queue outage'))
        log.mockImplementationOnce(() => {
            throw new Error('synthetic logger failure')
        })
        await expect(
            notifyCommittedSecurityChangeService({
                to: 'previous-contact@example.test',
                change: 'totp_enabled',
                auditReceipt: receipt,
            }),
        ).resolves.toBeUndefined()
        expect(enqueue).toHaveBeenCalledTimes(1)
        expect(log).toHaveBeenCalledTimes(1)
    })

    it('contains timestamp serialization failures after commit without queue access', async () => {
        await expect(
            notifyCommittedSecurityChangeService({
                to: 'previous-contact@example.test',
                change: 'passkey_added',
                auditReceipt: { ...receipt, createdAt: new Date(Number.NaN) },
            }),
        ).resolves.toBeUndefined()
        expect(enqueue).not.toHaveBeenCalled()
        expect(log).toHaveBeenCalledTimes(1)
    })
})
