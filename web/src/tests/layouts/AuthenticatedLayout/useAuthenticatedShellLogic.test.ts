import { afterEach, beforeEach, expect, it, vi } from 'bun:test'
import {
    hookReact,
    renderHook,
    resetHooks,
    runEffects,
} from '../hook-harness.ts'

const navigate = vi.fn(async () => {})
const applyTheme = vi.fn()
const resetTheme = vi.fn()
const remember = vi.fn()
const expand = vi.fn()
const favicon = { rel: '', href: '', parentNode: null }
const append = vi.fn()
let session: unknown
let settings: unknown
let browserPath: string | null = '/admin/users?sort=name'
const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
const originalDocument = Object.getOwnPropertyDescriptor(globalThis, 'document')
vi.mock('react', () => hookReact)
vi.mock('@tanstack/react-query', () => ({
    useQuery: (options: { queryKey: string[] }) => ({
        data: options.queryKey[0] === 'session' ? session : settings,
        isPending: false,
    }),
}))
vi.mock('@tanstack/react-router', () => ({ useNavigate: () => navigate }))
vi.mock('@/lib/Queries/appQueries.ts', () => ({
    authenticatedSessionQueryOptions: () => ({ queryKey: ['session'] }),
    systemSettingsQueryOptions: () => ({ queryKey: ['settings'] }),
}))
vi.mock('@/language/useTranslationStore.ts', () => ({
    default: () => ({ t: (key: string) => key }),
}))
vi.mock('@/lib/Browser/browser.ts', () => ({
    getCurrentBrowserPath: () => browserPath,
}))
vi.mock('@/lib/Theme/appTheme.ts', () => ({
    applyAppThemeSettings: applyTheme,
    resetAppThemeSettings: resetTheme,
}))
vi.mock('@/lib/Maintenance/maintenanceReturnPath.ts', () => ({
    rememberMaintenanceReturnPath: remember,
}))
vi.mock('@/lib/Restore/restoreReturnFragment.ts', () => ({
    rememberAuthenticatedRestoreUserId: vi.fn(),
}))
vi.mock('@/shared/Restore/Hooks/useRestoreNavigationBridge.ts', () => ({
    default: vi.fn(),
}))
vi.mock('@/shared/Images/Hooks/useLocalProfileImageVersion.ts', () => ({
    default: () => 42,
}))
vi.mock('@/layouts/AuthenticatedLayout/Hooks/useSessionActivity.ts', () => ({
    default: vi.fn(),
}))
vi.mock(
    '@/layouts/AuthenticatedLayout/Hooks/useAuthenticatedRealtimeEvents.ts',
    () => ({ default: vi.fn() }),
)
vi.mock(
    '@/layouts/AuthenticatedLayout/Hooks/useAuthenticatedNavigation.ts',
    () => ({
        default: () => ({
            state: {
                homeTo: '/dashboard',
                subtitle: 'Overview',
                visibleNavItems: [],
            },
        }),
    }),
)
vi.mock(
    '@/layouts/AuthenticatedLayout/Hooks/useAuthenticatedShellUiStore.ts',
    () => ({
        default: () => ({
            state: { isCollapsed: false, isMaintenanceBannerMinimized: true },
            handler: {
                expandMaintenanceBanner: expand,
                minimizeMaintenanceBanner: vi.fn(),
            },
        }),
    }),
)

const { default: useShell } =
    await import('@/layouts/AuthenticatedLayout/Hooks/useAuthenticatedShellLogic.ts')

beforeEach(() => {
    resetHooks()
    vi.clearAllMocks()
    vi.useFakeTimers()
    session = undefined
    settings = undefined
    browserPath = '/admin/users?sort=name'
    Object.defineProperty(globalThis, 'window', {
        configurable: true,
        value: { setInterval, clearInterval },
    })
    Object.defineProperty(globalThis, 'document', {
        configurable: true,
        value: {
            title: '',
            querySelector: () => favicon,
            createElement: () => favicon,
            head: { appendChild: append },
        },
    })
})
afterEach(() => {
    vi.useRealTimers()
    if (originalWindow)
        Object.defineProperty(globalThis, 'window', originalWindow)
    else Reflect.deleteProperty(globalThis, 'window')
    if (originalDocument)
        Object.defineProperty(globalThis, 'document', originalDocument)
    else Reflect.deleteProperty(globalThis, 'document')
})

it('provides anonymous defaults and applies and cleans up the shell theme', () => {
    const result = renderHook(useShell)
    expect(result.state.userId).toBeNull()
    expect(result.state.username).toBe('nav.user')
    expect(result.state.showMaintenanceBanner).toBe(false)
    expect(result.state.pendingMaintenanceExtensionRequest).toBeNull()
    expect(result.state.shellStyle.fontSize).toMatch(/px$/u)
    const cleanup = runEffects()
    expect(applyTheme).toHaveBeenCalledWith(
        expect.objectContaining({ themeMode: result.state.themeMode }),
    )
    expect(document.title).toBe(result.state.companyName)
    expect(favicon.href).toBe(result.state.systemFaviconSrc)
    expect(append).toHaveBeenCalledWith(favicon)
    expect(expand).toHaveBeenCalledTimes(1)
    cleanup()
    expect(resetTheme).toHaveBeenCalledTimes(1)
})

it('uses user appearance and company branding and updates a scheduled countdown', () => {
    session = {
        user: {
            id: 'user-1',
            username: 'Kevin',
            themeMode: 'light',
            fontSize: 18,
            fontFamily: 'inter',
            primaryColor: '#112233',
            customBackgroundDarkness: 30,
        },
        permissions: [],
    }
    settings = {
        companyName: 'Example',
        logoSrc64: '/logo.png',
        faviconSrc: '/icon.png',
        isMaintenanceModeScheduled: true,
        maintenanceStartsAt: new Date(Date.now() + 5000).toISOString(),
        pendingMaintenanceExtensionRequest: {
            id: 'request-1',
            user: { id: 'user-1', username: 'Kevin' },
        },
    }
    const result = renderHook(useShell)
    expect(result.state.username).toBe('Kevin')
    expect(result.state.companyName).toBe('Example')
    expect(result.state.profileImageSrc64).toContain('42')
    expect(result.state.showMaintenanceBanner).toBe(true)
    expect(result.state.millisecondsUntilMaintenance).toBe(5000)
    expect(result.state.pendingMaintenanceExtensionRequest?.user.id).toBe(
        'user-1',
    )
    const cleanup = runEffects()
    vi.advanceTimersByTime(1000)
    expect(renderHook(useShell).state.millisecondsUntilMaintenance).toBe(4000)
    cleanup()
    expect(vi.getTimerCount()).toBe(0)
})

it('remembers the current path before routing to active maintenance', () => {
    session = { user: { id: 'user-1' }, permissions: [] }
    settings = {
        isMaintenanceModeScheduled: true,
        maintenanceStartsAt: new Date(Date.now() - 1).toISOString(),
    }
    renderHook(useShell)
    runEffects()()
    expect(remember).toHaveBeenCalledWith('/admin/users?sort=name')
    expect(navigate).toHaveBeenCalledWith({
        to: '/maintenance',
        search: { redirect: '/admin/users?sort=name' },
    })
    vi.clearAllMocks()
    browserPath = null
    renderHook(useShell)
    runEffects()()
    expect(navigate).not.toHaveBeenCalled()
})
