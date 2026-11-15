import { beforeEach, describe, expect, it, vi } from 'bun:test'

const gateMocks = (function () {
    return {
        barrierIsHealthy: vi.fn(function () {
            return true
        }),
        isActive: vi.fn(async function () {
            return true
        }),
    }
})()

vi.mock('@/server/Admin/Backups/restore-state.service.ts', function () {
    return { isRestoreStateActiveService: gateMocks.isActive }
})

vi.mock(
    '@/server/Storage/storage-mutation-barrier-health.service.ts',
    function () {
        return {
            isStorageMutationBarrierHealthyService: gateMocks.barrierIsHealthy,
        }
    },
)

import {
    getRestoreRequestGateResponse,
    isRestoreGateBypassPath,
} from '@/server/Admin/Backups/restore-request-gate.service.ts'

describe('globales Restore-Request-Gate', function () {
    beforeEach(function () {
        vi.clearAllMocks()
        gateMocks.barrierIsHealthy.mockReturnValue(true)
        gateMocks.isActive.mockResolvedValue(true)
    })

    it('lässt ausschließlich Status, Fortschrittsseite und benötigte Assets passieren', async function () {
        const request = new Request('https://app.example.test/test')

        await expect(
            getRestoreRequestGateResponse(request, '/update-in-progress'),
        ).resolves.toBeNull()
        await expect(
            getRestoreRequestGateResponse(
                request,
                '/api/system/restore-status',
            ),
        ).resolves.toBeNull()
        await expect(
            getRestoreRequestGateResponse(request, '/assets/app.js'),
        ).resolves.toBeNull()
    })

    it.each([
        '/_serverFn/update/anything.js',
        '/_serverFn/update/anything.css',
        '/_serverFn/update/anything.map',
        '/_serverFn/update/anything.mjs',
        '/_serverFn/update/anything.woff2',
        '/api/admin/backups/restore.js',
        '/admin/users/custom.css',
    ])(
        'sperrt dynamische Pfade auch mit Asset-Endung: %s',
        async function (pathname) {
            expect(isRestoreGateBypassPath(pathname)).toBe(false)
            const response = await getRestoreRequestGateResponse(
                new Request(`https://app.example.test${pathname}`, {
                    method: 'POST',
                }),
                pathname,
            )
            expect(response?.status).toBe(503)
            expect(response?.headers.get('cache-control')).toBe('no-store')
        },
    )

    it('leitet HTML-Dokumente auf die globale Fortschrittsseite um', async function () {
        const response = await getRestoreRequestGateResponse(
            new Request(
                'https://app.example.test/admin/backups?status=completed',
                {
                    headers: { accept: 'text/html,application/xhtml+xml' },
                },
            ),
            '/admin/backups',
        )

        expect(response?.status).toBe(307)
        expect(response?.headers.get('location')).toBe(
            '/update-in-progress#return=%2Fadmin%2Fbackups%3Fstatus%3Dcompleted',
        )
        expect(response?.headers.get('cache-control')).toBe('no-store')
    })

    it('übernimmt keinen überlangen Rücksprungpfad', async function () {
        const response = await getRestoreRequestGateResponse(
            new Request(
                `https://app.example.test/admin/backups?filter=${'a'.repeat(2_100)}`,
                { headers: { accept: 'text/html' } },
            ),
            '/admin/backups',
        )

        expect(response?.headers.get('location')).toBe('/update-in-progress')
    })

    it('blockiert API- und Server-Fn-Aufrufe mit 503', async function () {
        const response = await getRestoreRequestGateResponse(
            new Request('https://app.example.test/_serverFn/update', {
                method: 'POST',
            }),
            '/_serverFn/update',
        )

        expect(response?.status).toBe(503)
        expect(response?.headers.get('retry-after')).toBe('3')
        await expect(response?.json()).resolves.toEqual({
            error: 'Das System wird gerade aus einem Backup wiederhergestellt.',
        })
    })

    it('lässt den normalen Verkehr ohne aktiven Restore unverändert', async function () {
        gateMocks.isActive.mockResolvedValue(false)

        await expect(
            getRestoreRequestGateResponse(
                new Request('https://app.example.test/admin/backups'),
                '/admin/backups',
            ),
        ).resolves.toBeNull()
    })

    it('bleibt bei einem unbestätigten Storage-Lock auch ohne Restore-Marker fail-closed', async function () {
        gateMocks.isActive.mockResolvedValue(false)
        gateMocks.barrierIsHealthy.mockReturnValue(false)

        const response = await getRestoreRequestGateResponse(
            new Request('https://app.example.test/_serverFn/update', {
                method: 'POST',
            }),
            '/_serverFn/update',
        )

        expect(response?.status).toBe(503)
    })
})
