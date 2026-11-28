import * as Query from '@tanstack/react-query'
import { afterEach, beforeEach, expect, it, vi } from 'bun:test'
import {
    hookReact,
    renderHook,
    resetHooks,
    runEffects,
} from '@/tests/layouts/hook-harness.ts'
import {
    restoreTestGlobals,
    stubTestGlobal,
} from '@/tests/shared/bunTestStubs.ts'
import type { RestoreStatus } from '@/lib/Restore/Types/restore.types.ts'

const queryExports = { ...Query }
const client = new Query.QueryClient()
const navigate = vi.fn(async () => {})
const capture = vi.fn()
let returnPath: string | null
let status: RestoreStatus | null
vi.mock('react', () => hookReact)
vi.mock('@tanstack/react-query', () => ({
    ...queryExports,
    useQueryClient: () => client,
}))
vi.mock('@tanstack/react-router', () => ({ useNavigate: () => navigate }))
vi.mock('@/shared/Restore/Hooks/useRestoreStatus.ts', () => ({
    default: () => ({
        state: {
            restoreStatus: status,
            isLoading: status === null,
            isError: false,
        },
    }),
}))
vi.mock('@/lib/Restore/restoreReturnPath.ts', () => ({
    getRestoreReturnPath: () => returnPath,
}))
vi.mock('@/lib/Restore/restoreReturnFragment.ts', () => ({
    captureRestoreReturnPathFromFragment: capture,
}))
const { default: useProgress } =
    await import('@/features/RestoreProgress/Hooks/useRestoreProgressLogic.ts')
function restoreStatus(value: RestoreStatus['status']): RestoreStatus {
    const base = {
        version: 1 as const,
        percent: 0,
        processedBytes: 0,
        totalBytes: 100,
        startedAt: null,
        updatedAt: null,
    }
    return value === 'idle'
        ? { ...base, status: value, phase: null }
        : { ...base, status: value, phase: 'validating' }
}
beforeEach(() => {
    resetHooks()
    vi.clearAllMocks()
    vi.useFakeTimers()
    status = null
    returnPath = '/user/catalog'
    client.clear()
    client.setQueryData(['private-pre-restore-data'], ['synthetic marker'])
    client.setQueryData(['system-restore-status'], { status: 'completed' })
    stubTestGlobal('window', { setTimeout, clearTimeout })
})
afterEach(() => {
    vi.useRealTimers()
    client.clear()
    restoreTestGlobals()
})

it.each([null, 'running', 'recovery-required'] as const)(
    'keeps the progress page for unresolved or blocked status %s',
    (value) => {
        status = value === null ? null : restoreStatus(value)
        expect(renderHook(useProgress).state.isLoading).toBe(value === null)
        runEffects()()
        vi.advanceTimersByTime(10000)
        expect(capture).toHaveBeenCalledTimes(1)
        expect(navigate).not.toHaveBeenCalled()
    },
)

it.each([
    { status: 'idle', delay: 500 },
    { status: 'completed', delay: 2000 },
    { status: 'failed', delay: 3500 },
] as const)(
    'waits $delay ms for $status before clearing stale data and returning',
    ({ status: value, delay }) => {
        status = restoreStatus(value)
        renderHook(useProgress)
        const cleanup = runEffects()
        vi.advanceTimersByTime(delay - 1)
        expect(navigate).not.toHaveBeenCalled()
        expect(client.getQueryData(['private-pre-restore-data'])).toBeDefined()
        vi.advanceTimersByTime(1)
        expect(navigate).toHaveBeenCalledWith({
            href: '/user/catalog',
            replace: true,
        })
        expect(
            client.getQueryData(['private-pre-restore-data']),
        ).toBeUndefined()
        expect(client.getQueryData(['system-restore-status'])).toBeDefined()
        cleanup()
    },
)

it('cancels redirects on cleanup and uses login when no stored return path exists', () => {
    status = restoreStatus('completed')
    renderHook(useProgress)
    runEffects()()
    vi.advanceTimersByTime(2000)
    expect(navigate).not.toHaveBeenCalled()
    returnPath = null
    renderHook(useProgress)
    const cleanup = runEffects()
    vi.advanceTimersByTime(2000)
    expect(navigate).toHaveBeenCalledWith({ href: '/login', replace: true })
    cleanup()
})
