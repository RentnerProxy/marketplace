import * as actualReact from 'react'
import * as actualQuery from '@tanstack/react-query'
import * as actualTable from '@tanstack/react-table'
import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test'
import { PERMISSIONS } from '@/config/permissions.config.ts'
import type {
    PermissionManagementOverview,
    PermissionManagementUser,
} from '@/features/Admin/PermissionManagement/Types/permission-management-domain.types.ts'

const reactExports = { ...actualReact }
const queryExports = { ...actualQuery }
const tableExports = { ...actualTable }
const cells: Array<unknown> = []
const refs: Array<{ current: unknown }> = []
const effects: Array<{
    setup: actualReact.EffectCallback
    dependencies?: ReadonlyArray<unknown>
    pending: boolean
    cleanup?: () => void
}> = []
let stateCursor = 0
let refCursor = 0
let effectCursor = 0
let overview: PermissionManagementOverview
let usersQueryEnabled = false
let overviewFetching = false
let overviewError = false
let overviewMissing = false
const refetchOverview = vi.fn(async () => {})
let receiveEvent: (event: { type: string; payload?: { scope: string } }) => void
const subscribe = vi.fn((listener: typeof receiveEvent) => {
    receiveEvent = listener
    return vi.fn()
})
const user: PermissionManagementUser = {
    id: '01941f29-7c00-7000-8000-000000000001',
    username: 'Testbenutzer',
    email: 'test@example.invalid',
    firstName: null,
    lastName: null,
    isActive: true,
    isSuperUser: false,
    isCurrentUser: false,
    permissions: [PERMISSIONS.USER_DASHBOARD],
}

vi.mock('react', () => ({
    ...reactExports,
    useState(initial: unknown) {
        const index = stateCursor++
        if (!(index in cells)) cells[index] = initial
        return [
            cells[index],
            (value: unknown) => {
                cells[index] =
                    typeof value === 'function' ? value(cells[index]) : value
            },
        ]
    },
    useRef(initial: unknown) {
        return (refs[refCursor++] ??= { current: initial })
    },
    useMemo(factory: () => unknown) {
        return factory()
    },
    useEffect(
        setup: actualReact.EffectCallback,
        dependencies?: ReadonlyArray<unknown>,
    ) {
        const index = effectCursor++
        const previous = effects[index]
        if (
            !previous ||
            !dependencies ||
            dependencies.some(
                (value, offset) =>
                    !Object.is(value, previous.dependencies?.[offset]),
            )
        ) {
            effects[index] = {
                setup,
                dependencies,
                pending: true,
                cleanup: previous?.cleanup,
            }
        }
    },
}))
vi.mock('@tanstack/react-query', () => ({
    ...queryExports,
    useQuery(options: { queryKey: ReadonlyArray<string>; enabled?: boolean }) {
        const isUsersQuery = options.queryKey[1] === 'users'
        if (isUsersQuery) usersQueryEnabled = options.enabled ?? true
        return {
            data:
                options.queryKey[0] === 'session'
                    ? { user: { id: 'actor' } }
                    : isUsersQuery
                      ? [user]
                      : overviewMissing
                        ? undefined
                        : overview,
            isLoading: false,
            isFetching: !isUsersQuery && overviewFetching,
            isError: !isUsersQuery && overviewError,
            refetch: refetchOverview,
        }
    },
    useMutation: () => ({ isPending: false, mutate: vi.fn() }),
    useQueryClient: () => queryClient,
}))
const queryClient = {
    invalidateQueries: vi.fn(),
    setQueryData: vi.fn(),
}
vi.mock('@tanstack/react-table', () => ({
    ...tableExports,
    useTable: () => ({
        state: { globalFilter: '', pagination: { pageIndex: 0 } },
        getRowModel: () => ({ rows: [{ original: user }] }),
        getRowCount: () => 1,
        getPageCount: () => 1,
        getCanPreviousPage: () => false,
        getCanNextPage: () => false,
        setPageIndex: vi.fn(),
    }),
}))
vi.mock('@rentnerkev/toasts', () => ({
    toast: { error: vi.fn(), success: vi.fn() },
}))
vi.mock('@/language/useTranslationStore.ts', () => ({
    default: () => ({ t: (key: string) => key }),
}))
vi.mock('@/lib/Queries/appQueries.ts', () => ({
    authenticatedSessionQueryOptions: () => ({ queryKey: ['session'] }),
}))
vi.mock('@/features/Admin/PermissionManagement/middleware.ts', () => ({
    getPermissionManagementOverviewHandler: vi.fn(),
    getPermissionManagementUsersHandler: vi.fn(),
    createPermissionPresetHandler: vi.fn(),
    updatePermissionPresetHandler: vi.fn(),
    deletePermissionPresetHandler: vi.fn(),
    replaceManagedUserPermissionsHandler: vi.fn(),
}))
vi.mock('@/websockets/Client/realtimeEventsClient.ts', () => ({
    subscribeToRealtimeEvents: subscribe,
}))

import usePermissionManagementLogic from '@/features/Admin/PermissionManagement/Hooks/usePermissionManagementLogic.ts'
import PermissionManagement from '@/features/Admin/PermissionManagement/index.tsx'
import PermissionPresetsPanel from '@/features/Admin/PermissionManagement/Components/PermissionPresetsPanel.tsx'
import UserPermissionsPanel from '@/features/Admin/PermissionManagement/Components/UserPermissionsPanel.tsx'

function render() {
    stateCursor = 0
    refCursor = 0
    effectCursor = 0
    return usePermissionManagementLogic()
}

function renderHook() {
    render()
    for (const effect of effects) {
        if (!effect.pending) continue
        effect.cleanup?.()
        const cleanup = effect.setup()
        effect.cleanup = typeof cleanup === 'function' ? cleanup : undefined
        effect.pending = false
    }
    return render()
}

function renderPage() {
    stateCursor = 0
    refCursor = 0
    effectCursor = 0
    return PermissionManagement()
}

function elements(
    node: actualReact.ReactNode,
): Array<actualReact.ReactElement<Record<string, unknown>>> {
    if (Array.isArray(node)) return node.flatMap(elements)
    if (!actualReact.isValidElement<Record<string, unknown>>(node)) return []
    return [node, ...elements(node.props.children as actualReact.ReactNode)]
}

beforeEach(() => {
    vi.clearAllMocks()
    cells.length = 0
    refs.length = 0
    effects.length = 0
    overviewFetching = false
    overviewError = false
    overviewMissing = false
    overview = {
        permissions: [],
        presets: [],
    }
})
afterEach(() => {
    for (const effect of effects) effect.cleanup?.()
    vi.restoreAllMocks()
})

describe('PermissionManagement Entwurfs-Lebenszyklus', () => {
    it('switches the visible screen panel through the tab controls and retries overview errors', () => {
        let nodes = elements(renderPage())
        expect(nodes.some((node) => node.type === UserPermissionsPanel)).toBe(
            true,
        )
        const tabs = nodes.find(
            (node) => typeof node.props.onTabChange === 'function',
        )
        const changeTab = tabs?.props.onTabChange
        if (typeof changeTab !== 'function')
            throw new Error('Missing tab control')
        changeTab('presets')
        nodes = elements(renderPage())
        expect(nodes.some((node) => node.type === PermissionPresetsPanel)).toBe(
            true,
        )
        changeTab('users')
        nodes = elements(renderPage())
        expect(nodes.some((node) => node.type === UserPermissionsPanel)).toBe(
            true,
        )
        overviewError = true
        nodes = elements(renderPage())
        expect(nodes.some((node) => node.type === UserPermissionsPanel)).toBe(
            false,
        )
        const retry = nodes.find((node) => node.type === 'button')?.props
            .onClick
        if (typeof retry !== 'function')
            throw new Error('Missing retry control')
        retry()
        expect(refetchOverview).toHaveBeenCalledTimes(1)
    })

    it('hides the super-user permission from assignable rights and retries failed overview queries', () => {
        overview.permissions = [
            {
                id: 'super',
                key: PERMISSIONS.ADMIN_SUPER_USER,
                name: 'Super',
                description: '',
            },
            {
                id: 'dashboard',
                key: PERMISSIONS.USER_DASHBOARD,
                name: 'Dashboard',
                description: '',
            },
        ]
        overviewFetching = true
        overviewError = true
        const hook = renderHook()
        expect(hook.state.permissions).toHaveLength(2)
        expect(
            hook.state.assignablePermissions.map(
                (permission) => permission.key,
            ),
        ).toEqual([PERMISSIONS.USER_DASHBOARD])
        expect(hook.state.isLoadingOverview).toBe(true)
        expect(hook.state.isOverviewError).toBe(true)
        hook.handler.handleRetryOverview()
        expect(refetchOverview).toHaveBeenCalledTimes(1)
    })

    it('renders empty safe defaults before the overview is available', () => {
        overviewMissing = true
        const hook = renderHook()
        expect(hook.state.permissions).toEqual([])
        expect(hook.state.presets).toEqual([])
    })

    it('invalidates permission metadata on preset changes and refreshes user caches for user events', () => {
        renderHook()
        receiveEvent({
            type: 'admin-permissions.updated',
            payload: { scope: 'defaults' },
        })
        expect(queryClient.invalidateQueries).not.toHaveBeenCalled()
        receiveEvent({
            type: 'admin-permissions.updated',
            payload: { scope: 'presets' },
        })
        expect(queryClient.invalidateQueries).toHaveBeenCalledWith({
            queryKey: ['admin-permission-management', 'overview'],
        })
        queryClient.invalidateQueries.mockClear()
        for (const type of ['admin-user.updated', 'admin-user.access-revoked'])
            receiveEvent({ type })
        expect(queryClient.invalidateQueries).toHaveBeenCalledTimes(4)
        expect(queryClient.invalidateQueries).toHaveBeenCalledWith({
            queryKey: ['admin-permission-management', 'users'],
        })
        expect(queryClient.invalidateQueries).toHaveBeenCalledWith({
            queryKey: ['admin-users'],
        })
        queryClient.invalidateQueries.mockClear()
        receiveEvent({ type: 'session.revoked' })
        expect(queryClient.invalidateQueries).not.toHaveBeenCalled()
    })

    it('erhält Preset- und Benutzerentwürfe über Tabwechsel', () => {
        let hook = renderHook()
        expect(usersQueryEnabled).toBe(true)
        hook.handler.handleTabChange('presets')
        hook = renderHook()
        hook.handler.permissionPresets.handleFieldChange('name', 'Entwurf')
        hook.handler.permissionPresets.handleTogglePermission(
            PERMISSIONS.USER_DASHBOARD,
        )
        hook.handler.handleTabChange('users')
        hook = renderHook()
        expect(usersQueryEnabled).toBe(true)
        hook.handler.managedUsers.handleSelectUser(user)
        hook.handler.managedUsers.handleTogglePermission(
            PERMISSIONS.ADMIN_DASHBOARD,
        )
        hook.handler.handleTabChange('presets')
        hook = renderHook()

        expect(usersQueryEnabled).toBe(false)
        expect(hook.state.permissionPresets.formValues.name).toBe('Entwurf')
        expect(hook.state.permissionPresets.formValues.permissionKeys).toEqual([
            PERMISSIONS.USER_DASHBOARD,
        ])
        expect(hook.state.managedUsers.selectedUser?.id).toBe(user.id)
        expect(hook.state.managedUsers.permissionKeys).toContain(
            PERMISSIONS.ADMIN_DASHBOARD,
        )
        expect(hook.state.managedUsers.isDirty).toBe(true)
        expect(subscribe).toHaveBeenCalledTimes(1)
    })
})
