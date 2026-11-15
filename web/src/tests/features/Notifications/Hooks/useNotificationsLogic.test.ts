import * as Query from '@tanstack/react-query'
import type { UseMutationOptions } from '@tanstack/react-query'
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
import type { Notification } from '@/features/Notifications/Types/notification-domain.types.ts'

const queryExports = { ...Query }
const client = new Query.QueryClient({
    defaultOptions: { mutations: { retry: false, gcTime: Infinity } },
})
const pending: Promise<unknown>[] = []
const mark = vi.fn(async (_input: unknown) => undefined)
const markAll = vi.fn(async () => undefined)
const toastError = vi.fn()
const contains = vi.fn(() => false)
const notificationRef = { current: { contains } }
let mutationPending = false
class TestNode extends EventTarget {}
const originalNode = Object.getOwnPropertyDescriptor(globalThis, 'Node')
let browserDocument: TestNode
vi.mock('react', () => ({ ...hookReact, useRef: () => notificationRef }))
vi.mock('@tanstack/react-query', () => ({
    ...queryExports,
    useQueryClient: () => client,
    useQuery: () => ({
        data: client.getQueryData(['notifications']),
        isLoading: false,
    }),
    useMutation<TData, TError, TVariables, TContext>(
        options: UseMutationOptions<TData, TError, TVariables, TContext>,
    ) {
        const observer = new queryExports.MutationObserver(client, options)
        return {
            isPending: mutationPending,
            variables: 'notice-1',
            mutate: (variables: TVariables) => {
                pending.push(observer.mutate(variables).catch(() => undefined))
            },
        }
    },
}))
vi.mock('@/features/Notifications/middleware.ts', () => ({
    getNotificationsHandler: vi.fn(),
    markNotificationAsReadHandler: mark,
    markAllNotificationsAsReadHandler: markAll,
}))
vi.mock('@rentnerkev/toasts', () => ({ toast: { error: toastError } }))
vi.mock('@/language/useTranslationStore.ts', () => ({
    default: () => ({ language: 'de', t: (key: string) => key }),
}))
const { default: useNotifications } =
    await import('@/features/Notifications/Hooks/useNotificationsLogic.ts')
const render = () => renderHook(useNotifications)
const notifications: Notification[] = [
    {
        id: 'notice-1',
        title: 'Unread',
        message: 'Synthetic unread',
        type: 'info',
        referenceId: null,
        isRead: false,
        readAt: null,
        createdAt: '2026-11-05T12:00:00Z',
    },
    {
        id: 'notice-2',
        title: 'Read',
        message: 'Synthetic read',
        type: 'info',
        referenceId: null,
        isRead: true,
        readAt: '2026-11-05T12:05:00Z',
        createdAt: '2026-11-05T12:00:00Z',
    },
]
beforeEach(() => {
    resetHooks()
    vi.clearAllMocks()
    pending.length = 0
    mutationPending = false
    contains.mockReturnValue(false)
    mark.mockResolvedValue(undefined)
    markAll.mockResolvedValue(undefined)
    client.clear()
    client.setQueryData(['notifications'], notifications)
    browserDocument = new TestNode()
    stubTestGlobal('document', browserDocument)
    Object.defineProperty(globalThis, 'Node', {
        configurable: true,
        value: TestNode,
    })
})
afterEach(() => {
    client.clear()
    restoreTestGlobals()
    if (originalNode) Object.defineProperty(globalThis, 'Node', originalNode)
    else Reflect.deleteProperty(globalThis, 'Node')
})

it('filters unread/read tabs and handles an empty notification cache', () => {
    expect(render().state.unreadCount).toBe(1)
    expect(
        render().state.filteredNotifications.map((entry) => entry.id),
    ).toEqual(['notice-1'])
    render().handler.handleTabChange('read')
    expect(
        render().state.filteredNotifications.map((entry) => entry.id),
    ).toEqual(['notice-2'])
    expect(
        render().state.dateFormatter.format(new Date('2026-11-05T12:00:00Z')),
    ).toContain('2026')
    mutationPending = true
    expect(render().state.markingNotificationId).toBe('notice-1')
    client.removeQueries({ queryKey: ['notifications'] })
    expect(render().state.unreadCount).toBe(0)
})

it('marks one notification and all notifications while preserving existing read timestamps', async () => {
    render().handler.handleMarkAsRead('notice-1')
    await Promise.all(pending)
    expect(mark).toHaveBeenCalledWith({ data: { notificationId: 'notice-1' } })
    expect(render().state.unreadCount).toBe(0)
    expect(
        client.getQueryData<Notification[]>(['notifications'])?.[1]?.readAt,
    ).toBe(notifications[1]?.readAt)
    render().handler.handleMarkAllAsRead()
    await Promise.all(pending)
    expect(markAll).toHaveBeenCalledTimes(1)
    expect(
        client
            .getQueryData<Notification[]>(['notifications'])
            ?.every((entry) => entry.isRead && entry.readAt),
    ).toBe(true)
    client.removeQueries({ queryKey: ['notifications'] })
    render().handler.handleMarkAsRead('missing')
    render().handler.handleMarkAllAsRead()
    await Promise.all(pending)
    expect(client.getQueryData(['notifications'])).toEqual([])
})

it('reports both mutation failures without changing cached unread notifications', async () => {
    mark.mockRejectedValueOnce(new Error('Synthetic update failure'))
    markAll.mockRejectedValueOnce(new Error('Synthetic update failure'))
    render().handler.handleMarkAsRead('notice-1')
    render().handler.handleMarkAllAsRead()
    await Promise.all(pending)
    expect(toastError).toHaveBeenCalledTimes(2)
    expect(render().state.unreadCount).toBe(1)
})

it('closes on outside clicks and Escape and removes document listeners on cleanup', () => {
    render()
    runEffects()()
    render().handler.handleToggle()
    expect(render().state.isOpen).toBe(true)
    let cleanup = runEffects()
    contains.mockReturnValue(true)
    browserDocument.dispatchEvent(new Event('pointerdown'))
    expect(render().state.isOpen).toBe(true)
    contains.mockReturnValue(false)
    browserDocument.dispatchEvent(new Event('pointerdown'))
    expect(render().state.isOpen).toBe(false)
    cleanup()
    render().setter.setIsOpen(true)
    render()
    cleanup = runEffects()
    browserDocument.dispatchEvent(
        Object.assign(new Event('keydown'), { key: 'Enter' }),
    )
    expect(render().state.isOpen).toBe(true)
    browserDocument.dispatchEvent(
        Object.assign(new Event('keydown'), { key: 'Escape' }),
    )
    expect(render().state.isOpen).toBe(false)
    cleanup()
    render().setter.setIsOpen(true)
    browserDocument.dispatchEvent(new Event('pointerdown'))
    expect(render().state.isOpen).toBe(true)
})
