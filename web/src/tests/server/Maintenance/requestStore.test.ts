import { afterEach, describe, expect, it, vi } from 'bun:test'
import {
    clearPendingMaintenanceExtensionRequest,
    getPendingMaintenanceExtensionRequest,
    setPendingMaintenanceExtensionRequest,
} from '@/server/Maintenance/requestStore.ts'

const valkeyState = (function () {
    return new Map<string, string>()
})()
const pendingRequestKey = 'rentnerproxy-marketplace:maintenance:extension-request'

vi.mock('@/server/Valkey/valkey.service.ts', function () {
    return {
        getValkeyConnection: function () {
            return {
                get: async function (key: string) {
                    return valkeyState.get(key) ?? null
                },
                set: async function (
                    key: string,
                    value: string,
                    _expirationMode: string,
                    _ttl: number,
                    _condition: string,
                ) {
                    if (valkeyState.has(key)) {
                        return null
                    }

                    valkeyState.set(key, value)
                    return 'OK'
                },
                eval: async function (
                    _script: string,
                    _keyCount: number,
                    key: string,
                    expected: string,
                ) {
                    if (valkeyState.get(key) !== expected) {
                        return 0
                    }

                    valkeyState.delete(key)
                    return 1
                },
            }
        },
    }
})
describe('Wartungsverschiebungsantrag', function () {
    afterEach(async function () {
        await clearPendingMaintenanceExtensionRequest()
    })

    it('behält einen offenen Antrag für nachfolgende Abfragen', async function () {
        const request = {
            id: '0f1b2c3d-4e5f-4678-9abc-def012345678',
            userId: '1f2b3c4d-5e6f-4789-abcd-ef0123456789',
            username: 'demo-user',
            reason: 'Ich benötige noch etwas mehr Zeit.',
            requestedAt: new Date('2026-07-02T08:00:00.000Z'),
        }

        await setPendingMaintenanceExtensionRequest(request)

        await expect(getPendingMaintenanceExtensionRequest()).resolves.toEqual(
            request,
        )
    })

    it('löscht nur den passenden offenen Antrag', async function () {
        const request = {
            id: '0f1b2c3d-4e5f-4678-9abc-def012345678',
            userId: '1f2b3c4d-5e6f-4789-abcd-ef0123456789',
            username: 'demo-user',
            reason: 'Ich benötige noch etwas mehr Zeit.',
            requestedAt: new Date('2026-07-02T08:00:00.000Z'),
        }

        await setPendingMaintenanceExtensionRequest(request)

        await expect(
            clearPendingMaintenanceExtensionRequest(
                '2f3b4c5d-6e7f-489a-bcde-f01234567890',
            ),
        ).resolves.toBeNull()
        await expect(getPendingMaintenanceExtensionRequest()).resolves.toEqual(
            request,
        )
        await expect(
            clearPendingMaintenanceExtensionRequest(request.id),
        ).resolves.toEqual(request)
        await expect(
            getPendingMaintenanceExtensionRequest(),
        ).resolves.toBeNull()
    })

    it('verwirft Valkey-Daten mit unpassenden Feldtypen', async function () {
        valkeyState.set(
            pendingRequestKey,
            JSON.stringify({
                id: 1,
                userId: { value: 'user-id' },
                username: ['demo-user'],
                reason: true,
                requestedAt: new Date().toISOString(),
            }),
        )

        await expect(
            getPendingMaintenanceExtensionRequest(),
        ).resolves.toBeNull()
    })
})
