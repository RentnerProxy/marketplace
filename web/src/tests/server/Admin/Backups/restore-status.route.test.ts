import { beforeEach, describe, expect, it, vi } from 'bun:test'

const statusMocks = (function () {
    return {
        barrierIsHealthy: vi.fn(function () {
            return true
        }),
        getState: vi.fn(async function () {
            return null as Record<string, unknown> | null
        }),
    }
})()

vi.mock('@/server/Admin/Backups/restore-state.service.ts', function () {
    return { getPublicRestoreStateService: statusMocks.getState }
})

vi.mock(
    '@/server/Storage/storage-mutation-barrier-health.service.ts',
    function () {
        return {
            isStorageMutationBarrierHealthyService:
                statusMocks.barrierIsHealthy,
        }
    },
)

import { handleRestoreStatusRequest } from '@/routes/api/system/restore-status.ts'

describe('öffentlicher Restore-Status', function () {
    beforeEach(function () {
        vi.clearAllMocks()
        statusMocks.barrierIsHealthy.mockReturnValue(true)
        statusMocks.getState.mockResolvedValue(null)
    })

    it('liefert im Leerlauf ausschließlich den öffentlichen No-Store-Vertrag', async function () {
        const response = await handleRestoreStatusRequest(
            new Request('https://app.example.test/api/system/restore-status'),
        )

        expect(response.status).toBe(200)
        expect(response.headers.get('cache-control')).toBe('no-store')
        await expect(response.json()).resolves.toEqual({
            version: 1,
            status: 'idle',
            phase: null,
            percent: null,
            processedBytes: 0,
            totalBytes: 0,
            startedAt: null,
            updatedAt: null,
        })
    })

    it('gibt den groben aktiven Fortschritt ohne Backup-Metadaten aus', async function () {
        statusMocks.getState.mockResolvedValue({
            version: 1,
            status: 'running',
            phase: 'validating',
            percent: 25,
            processedBytes: 256,
            totalBytes: 1_024,
            startedAt: '2026-08-11T10:00:00.000Z',
            updatedAt: '2026-08-11T10:00:01.000Z',
        })
        const response = await handleRestoreStatusRequest(
            new Request('https://app.example.test/api/system/restore-status'),
        )
        const payload = await response.json()

        expect(payload).toMatchObject({
            status: 'running',
            phase: 'validating',
            percent: 25,
        })
        expect(payload).not.toHaveProperty('backupId')
        expect(payload).not.toHaveProperty('fileName')
        expect(payload).not.toHaveProperty('errorMessage')
    })

    it('unterstützt HEAD ohne Response-Body', async function () {
        const response = await handleRestoreStatusRequest(
            new Request('https://app.example.test/api/system/restore-status', {
                method: 'HEAD',
            }),
        )

        expect(response.status).toBe(200)
        expect(response.headers.get('cache-control')).toBe('no-store')
        expect(await response.text()).toBe('')
    })

    it('meldet einen unbestätigten Storage-Lock öffentlich fail-closed und über HEAD als nicht bereit', async function () {
        statusMocks.barrierIsHealthy.mockReturnValue(false)

        const getResponse = await handleRestoreStatusRequest(
            new Request('https://app.example.test/api/system/restore-status'),
        )
        const headResponse = await handleRestoreStatusRequest(
            new Request('https://app.example.test/api/system/restore-status', {
                method: 'HEAD',
            }),
        )

        expect(getResponse.status).toBe(200)
        await expect(getResponse.json()).resolves.toMatchObject({
            status: 'recovery-required',
            phase: 'rolling-back',
        })
        expect(headResponse.status).toBe(503)
        expect(headResponse.headers.get('retry-after')).toBe('3')
        expect(await headResponse.text()).toBe('')
    })
})
