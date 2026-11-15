import * as actualReact from 'react'
import * as actualQuery from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'bun:test'
import type { UseMaintenanceSettingsParams } from '@/features/Admin/SystemSettings/Types/system-settings-logic.types.ts'

const reactExports = { ...actualReact }
const queryExports = { ...actualQuery }
const cells: unknown[] = []
const mutations: Promise<unknown>[] = []
let stateCursor = 0
const updateMaintenanceMode = vi.fn(async (_input: unknown) => ({
    success: true,
}))
const resolveExtensionRequest = vi.fn(async (_input: unknown) => ({
    success: true,
}))
const params: UseMaintenanceSettingsParams = {
    currentMaintenanceStartsAt: '2026-12-01T14:30:00.000Z',
    pendingMaintenanceExtensionRequest: {
        id: 'request-1',
        reason: 'Bitte später starten',
        requestedAt: '2026-11-01T10:00:00.000Z',
        user: { id: 'user-1', username: 'Testbenutzer' },
    },
}

vi.mock('react', () => ({
    ...reactExports,
    useState(initial: unknown) {
        const index = stateCursor++
        if (!(index in cells)) {
            cells[index] = typeof initial === 'function' ? initial() : initial
        }
        return [
            cells[index],
            (value: unknown) => {
                cells[index] =
                    typeof value === 'function' ? value(cells[index]) : value
            },
        ]
    },
}))
vi.mock('@tanstack/react-query', () => ({
    ...queryExports,
    useQueryClient: () => ({ invalidateQueries: vi.fn() }),
    useMutation<Variables, Result>(options: {
        mutationFn: (variables: Variables) => Promise<Result>
    }) {
        return {
            isPending: false,
            mutate(variables: Variables) {
                mutations.push(options.mutationFn(variables))
            },
        }
    },
}))
vi.mock('@rentnerkev/toasts', () => ({
    toast: { error: vi.fn(), success: vi.fn() },
}))
vi.mock('@/shared/Errors/toastAppError.ts', () => ({ toastAppError: vi.fn() }))
vi.mock('@/language/useTranslationStore.ts', () => ({
    default: () => ({ t: (key: string) => key }),
}))
vi.mock('@/lib/Queries/appQueries.ts', () => ({
    ADMIN_SYSTEM_SETTINGS_QUERY_KEY: ['admin', 'system-settings'],
}))
vi.mock('@/features/Admin/SystemSettings/middleware.ts', () => ({
    updateMaintenanceModeHandler: updateMaintenanceMode,
    resolveMaintenanceExtensionRequestHandler: resolveExtensionRequest,
}))

import useMaintenanceSettings from '@/features/Admin/SystemSettings/Hooks/useMaintenanceSettings.ts'

function renderHook(overrides: Partial<UseMaintenanceSettingsParams> = {}) {
    stateCursor = 0
    useMaintenanceSettings({ ...params, ...overrides })
    stateCursor = 0
    return useMaintenanceSettings({ ...params, ...overrides })
}

beforeEach(() => {
    cells.length = 0
    mutations.length = 0
    vi.clearAllMocks()
})

describe('Wartungsplanung mit serialisierten Werten', () => {
    it('speichert den ausgewählten ISO-Zeitpunkt unverändert', async () => {
        let hook = renderHook()
        const startsAt = '2026-12-02T16:45:00.000Z'
        hook.handler.handleMaintenanceStartsAtChange(startsAt)
        hook = renderHook()
        expect(hook.state.maintenanceStartsAt).toBe(startsAt)
        hook.handler.handleEnableMaintenanceMode()
        await Promise.all(mutations)
        expect(updateMaintenanceMode).toHaveBeenCalledWith({
            data: { isEnabled: true, startsAt },
        })
    })

    it('übernimmt aktualisierte Remote-Werte und ersetzt den Entwurf', () => {
        const hook = renderHook()
        hook.handler.handleMaintenanceStartsAtChange('2026-12-03T10:00:00.000Z')
        const startsAt = '2026-12-04T18:00:00.000Z'
        expect(
            renderHook({ currentMaintenanceStartsAt: startsAt }).state
                .maintenanceStartsAt,
        ).toBe(startsAt)
    })

    it('verhindert eine Planung nach dem Leeren, erlaubt aber das Deaktivieren', async () => {
        let hook = renderHook()
        hook.handler.handleMaintenanceStartsAtChange(undefined)
        hook = renderHook()
        expect(hook.state.maintenanceStartsAt).toBeUndefined()
        hook.handler.handleEnableMaintenanceMode()
        expect(await mutations[0]).toEqual({
            success: false,
            error: 'admin.systemSettings.maintenanceStartRequired',
        })
        expect(updateMaintenanceMode).not.toHaveBeenCalled()
        hook.handler.handleDisableMaintenanceMode()
        await Promise.all(mutations)
        expect(updateMaintenanceMode).toHaveBeenCalledWith({
            data: { isEnabled: false },
        })
    })

    it('initialisiert ohne Remote-Zeitpunkt eine zukünftige ISO-Zeit', () => {
        const before = Date.now()
        const hook = renderHook({ currentMaintenanceStartsAt: null })
        expect(typeof hook.state.maintenanceStartsAt).toBe('string')
        expect(
            Date.parse(hook.state.maintenanceStartsAt!),
        ).toBeGreaterThanOrEqual(before + 15 * 60 * 1000)
        expect(
            hook.state.maintenanceMinDateTime.getTime(),
        ).toBeGreaterThanOrEqual(before)
    })
})

describe('Wartungsverschiebung mit nullable Minuten', () => {
    it.each([null, 0, -1, 121, 1.5, NaN, Infinity])(
        'blockiert ungültige Freigaben (%s) und erlaubt weiterhin die Ablehnung',
        async (minutes) => {
            let hook = renderHook()
            hook.handler.handleMaintenanceExtensionMinutesChange(minutes)
            hook = renderHook()
            expect(hook.state.maintenanceExtensionMinutes).toBe(minutes)
            expect(hook.state.maintenanceExtensionMinutesError).toBe(
                'admin.systemSettings.extensionMinutesInvalid',
            )
            hook.handler.handleApproveMaintenanceExtensionRequest()
            expect(await mutations[0]).toEqual({
                success: false,
                error: 'admin.systemSettings.extensionMinutesInvalid',
            })
            expect(resolveExtensionRequest).not.toHaveBeenCalled()
            hook.handler.handleRejectMaintenanceExtensionRequest()
            await Promise.all(mutations)
            expect(resolveExtensionRequest).toHaveBeenCalledWith({
                data: {
                    requestId: 'request-1',
                    status: 'rejected',
                    extensionMinutes: undefined,
                },
            })
        },
    )

    it.each([1, 10, 120])(
        'speichert gültige ganze Minuten (%s)',
        async (minutes) => {
            let hook = renderHook()
            hook.handler.handleMaintenanceExtensionMinutesChange(minutes)
            hook = renderHook()
            expect(hook.state.maintenanceExtensionMinutesError).toBeNull()
            hook.handler.handleApproveMaintenanceExtensionRequest()
            await Promise.all(mutations)
            expect(resolveExtensionRequest).toHaveBeenCalledWith({
                data: {
                    requestId: 'request-1',
                    status: 'approved',
                    extensionMinutes: minutes,
                },
            })
        },
    )

    it('sendet ohne offenen Antrag keine Auflösung', async () => {
        const hook = renderHook({ pendingMaintenanceExtensionRequest: null })
        hook.handler.handleRejectMaintenanceExtensionRequest()
        expect(await mutations[0]).toEqual({
            success: false,
            error: 'admin.systemSettings.extensionRequestMissing',
        })
        expect(resolveExtensionRequest).not.toHaveBeenCalled()
    })
})
