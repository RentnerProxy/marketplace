import * as actualReact from 'react'
import * as actualReactQuery from '@tanstack/react-query'
import { QueryClient } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'bun:test'
import { RESTORE_STATUS_QUERY_KEY } from '@/lib/Restore/restoreStatus.ts'

const bridgeMocks = (function () {
    return {
        clearReturnPath: vi.fn(),
        currentPath: vi.fn(function () {
            return '/admin/backups?page=2#history'
        }),
        effectRuns: 2,
        navigate: vi.fn(async function () {}),
        observedRestore: { current: false },
        queryClient: null as unknown,
        rememberReturnPath: vi.fn(),
        restoreStatus: null as unknown,
    }
})()

const actualReactExports = { ...actualReact }
const actualReactQueryExports = { ...actualReactQuery }

vi.mock('react', function () {
    return {
        ...actualReactExports,
        useEffect: function (effect: () => void | (() => void)) {
            for (let index = 0; index < bridgeMocks.effectRuns; index += 1) {
                effect()
            }
        },
        useRef: function () {
            return bridgeMocks.observedRestore
        },
    }
})

vi.mock('@tanstack/react-query', function () {
    return {
        ...actualReactQueryExports,
        useQueryClient: function () {
            return bridgeMocks.queryClient
        },
    }
})

vi.mock('@tanstack/react-router', function () {
    return {
        useNavigate: function () {
            return bridgeMocks.navigate
        },
    }
})

vi.mock('@/lib/Browser/browser.ts', function () {
    return { getCurrentBrowserPath: bridgeMocks.currentPath }
})

vi.mock('@/lib/Restore/restoreReturnPath.ts', function () {
    return {
        clearRestoreReturnPath: bridgeMocks.clearReturnPath,
        rememberRestoreReturnPath: bridgeMocks.rememberReturnPath,
    }
})

vi.mock('@/shared/Restore/Hooks/useRestoreStatus.ts', function () {
    return {
        default: function () {
            return {
                state: {
                    restoreStatus: bridgeMocks.restoreStatus,
                    isLoading: false,
                    isError: false,
                },
            }
        },
    }
})

import useRestoreNavigationBridge from '@/shared/Restore/Hooks/useRestoreNavigationBridge.ts'

describe('Restore-SPA-Navigation', function () {
    beforeEach(function () {
        vi.clearAllMocks()
        bridgeMocks.effectRuns = 2
        bridgeMocks.observedRestore.current = false
        bridgeMocks.queryClient = new QueryClient()
        bridgeMocks.rememberReturnPath.mockReturnValue(
            '/admin/backups?page=2#history',
        )
        bridgeMocks.restoreStatus = { status: 'running' }
    })

    it('navigiert auch bei wiederholtem React-Effekt genau einmal und erhält ausschließlich den Restore-Status', function () {
        const queryClient = bridgeMocks.queryClient as QueryClient
        const restoreStatus = {
            version: 1,
            status: 'running',
            phase: 'restoring-database',
            percent: 70,
        }
        queryClient.setQueryData(RESTORE_STATUS_QUERY_KEY, restoreStatus)
        queryClient.setQueryData(['authenticated-session'], {
            user: { id: 'alter-stand' },
        })
        queryClient.setQueryData(['admin-backups'], ['alter-stand'])

        useRestoreNavigationBridge({
            isPreRestoreIdentityResolved: true,
            preRestoreUserId: '01912f5e-7b4a-7c3d-8e9f-0123456789ab',
        })

        expect(bridgeMocks.rememberReturnPath).toHaveBeenCalledTimes(1)
        expect(bridgeMocks.rememberReturnPath).toHaveBeenCalledWith(
            '/admin/backups?page=2#history',
            '01912f5e-7b4a-7c3d-8e9f-0123456789ab',
        )
        expect(bridgeMocks.navigate).toHaveBeenCalledTimes(1)
        expect(bridgeMocks.navigate).toHaveBeenCalledWith({
            to: '/update-in-progress',
            hash: 'return=%2Fadmin%2Fbackups%3Fpage%3D2%23history',
            replace: true,
        })
        expect(
            queryClient.getQueryData<typeof restoreStatus>(
                RESTORE_STATUS_QUERY_KEY,
            ),
        ).toEqual(restoreStatus)
        expect(queryClient.getQueryData(['authenticated-session'])).toBe(
            undefined,
        )
        expect(queryClient.getQueryData(['admin-backups'])).toBe(undefined)
    })

    it('wartet auf die aufgelöste Identität, bevor der Cache geleert wird', function () {
        const queryClient = bridgeMocks.queryClient as QueryClient
        queryClient.setQueryData(['authenticated-session'], {
            user: { id: 'vor-restore' },
        })

        useRestoreNavigationBridge({ isPreRestoreIdentityResolved: false })

        expect(bridgeMocks.navigate).not.toHaveBeenCalled()
        expect(bridgeMocks.rememberReturnPath).not.toHaveBeenCalled()
        expect(
            queryClient.getQueryData<{ user: { id: string } }>([
                'authenticated-session',
            ]),
        ).toEqual({ user: { id: 'vor-restore' } })
        expect(bridgeMocks.observedRestore.current).toBe(false)
    })

    it('entfernt einen veralteten Rückweg nur vor einem beobachteten Restore', function () {
        bridgeMocks.effectRuns = 1
        bridgeMocks.restoreStatus = { status: 'idle' }

        useRestoreNavigationBridge({ clearStaleReturnPath: true })

        expect(bridgeMocks.clearReturnPath).toHaveBeenCalledTimes(1)
        bridgeMocks.observedRestore.current = true
        useRestoreNavigationBridge({ clearStaleReturnPath: true })
        expect(bridgeMocks.clearReturnPath).toHaveBeenCalledTimes(1)
        expect(bridgeMocks.navigate).not.toHaveBeenCalled()
    })
})
