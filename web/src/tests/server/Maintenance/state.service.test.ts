import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
    vi,
    setSystemTime,
} from 'bun:test'
import { publishMaintenanceModeChangedService } from '@/server/Realtime/publish.service.ts'
import {
    deriveMaintenanceState,
    getFreshMaintenanceStateService,
    getMaintenanceStateService,
    invalidateMaintenanceStateService,
    publishMaintenanceStateService,
} from '@/server/Maintenance/state.service.ts'

const dbMock = (function () {
    const state = {
        settingsRows: [] as Array<{
            isMaintenanceModeEnabled: boolean
            maintenanceStartsAt: Date | null
        }>,
    }
    const selectChain = {
        from: vi.fn(),
        limit: vi.fn(async function () {
            return state.settingsRows
        }),
    }
    selectChain.from.mockReturnValue(selectChain)

    return {
        database: {
            select: vi.fn(function () {
                return selectChain
            }),
        },
        state,
        limit: selectChain.limit,
    }
})()

vi.mock('@/db', function () {
    return { db: dbMock.database }
})

vi.mock('@/db/schema.ts', function () {
    return { systemSettings: {} }
})

vi.mock('@/server/Realtime/publish.service.ts', function () {
    return {
        publishMaintenanceModeChangedService: vi.fn(async function () {}),
    }
})

describe('Maintenance-State-Service', function () {
    const now = new Date('2026-01-01T12:00:00.000Z')

    beforeEach(function () {
        vi.useFakeTimers()
        setSystemTime(now)
        vi.clearAllMocks()
        invalidateMaintenanceStateService()
        dbMock.state.settingsRows = []
    })

    afterEach(function () {
        vi.useRealTimers()
    })

    it('leitet deaktivierte, aktive und geplante Zustände deterministisch ab', function () {
        const disabledStartsAt = new Date('2026-01-01T11:00:00.000Z')

        expect(
            deriveMaintenanceState(
                {
                    isMaintenanceModeEnabled: false,
                    maintenanceStartsAt: disabledStartsAt,
                },
                now,
            ),
        ).toEqual({
            isActive: false,
            isScheduled: false,
            startsAt: disabledStartsAt.toISOString(),
        })
        expect(
            deriveMaintenanceState(
                {
                    isMaintenanceModeEnabled: true,
                    maintenanceStartsAt: now,
                },
                now,
            ),
        ).toEqual({
            isActive: true,
            isScheduled: false,
            startsAt: now.toISOString(),
        })
        expect(
            deriveMaintenanceState(
                {
                    isMaintenanceModeEnabled: true,
                    maintenanceStartsAt: new Date('2026-01-01T12:01:00.000Z'),
                },
                now,
            ),
        ).toEqual({
            isActive: false,
            isScheduled: true,
            startsAt: '2026-01-01T12:01:00.000Z',
        })
    })

    it('liest den Auth-Zustand aus den Systemeinstellungen', async function () {
        dbMock.state.settingsRows = [
            {
                isMaintenanceModeEnabled: true,
                maintenanceStartsAt: new Date('2026-01-01T12:01:00.000Z'),
            },
        ]

        await expect(getMaintenanceStateService()).resolves.toEqual({
            isActive: false,
            isScheduled: true,
            startsAt: '2026-01-01T12:01:00.000Z',
        })
        expect(dbMock.database.select).toHaveBeenCalledTimes(1)
    })

    it('publiziert denselben abgeleiteten Zustand als Realtime-Payload', async function () {
        const startsAt = new Date('2026-01-01T12:01:00.000Z')

        await publishMaintenanceStateService(
            {
                isMaintenanceModeEnabled: true,
                maintenanceStartsAt: startsAt,
            },
            now,
        )

        expect(publishMaintenanceModeChangedService).toHaveBeenCalledWith({
            isMaintenanceModeEnabled: true,
            isMaintenanceModeActive: false,
            isMaintenanceModeScheduled: true,
            maintenanceStartsAt: startsAt.toISOString(),
            updatedAt: now.toISOString(),
        })
    })

    it('coalesces concurrent reads and advances a scheduled start within the cache lifetime', async function () {
        const startsAt = new Date(now.getTime() + 100)
        dbMock.state.settingsRows = [
            { isMaintenanceModeEnabled: true, maintenanceStartsAt: startsAt },
        ]

        const reads = await Promise.all([
            getMaintenanceStateService(),
            getMaintenanceStateService(),
        ])
        expect(reads.map((read) => read.isScheduled)).toEqual([true, true])
        setSystemTime(startsAt)
        expect((await getMaintenanceStateService()).isActive).toBe(true)
        expect(dbMock.database.select).toHaveBeenCalledTimes(1)
    })

    it('keeps access checks fresh and retries a failed cache refresh after expiration', async function () {
        expect((await getMaintenanceStateService()).isActive).toBe(false)
        dbMock.state.settingsRows = [
            { isMaintenanceModeEnabled: true, maintenanceStartsAt: now },
        ]
        expect((await getFreshMaintenanceStateService()).isActive).toBe(true)
        expect((await getMaintenanceStateService()).isActive).toBe(false)

        setSystemTime(new Date(now.getTime() + 1_000))
        const failure = new Error('Synthetic unavailable database')
        dbMock.limit.mockRejectedValueOnce(failure)
        await expect(getMaintenanceStateService()).rejects.toBe(failure)
        expect((await getMaintenanceStateService()).isActive).toBe(true)
        expect(dbMock.database.select).toHaveBeenCalledTimes(4)
    })

    it('retries an in-flight read superseded by an invalidation', async function () {
        const stale = Promise.withResolvers<typeof dbMock.state.settingsRows>()
        dbMock.limit.mockReturnValueOnce(stale.promise)
        const firstRead = getMaintenanceStateService()
        invalidateMaintenanceStateService()
        dbMock.state.settingsRows = [
            { isMaintenanceModeEnabled: true, maintenanceStartsAt: now },
        ]
        expect((await getMaintenanceStateService()).isActive).toBe(true)

        stale.resolve([])
        expect((await firstRead).isActive).toBe(true)
        expect((await getMaintenanceStateService()).isActive).toBe(true)
        expect(dbMock.database.select).toHaveBeenCalledTimes(2)
    })
})
