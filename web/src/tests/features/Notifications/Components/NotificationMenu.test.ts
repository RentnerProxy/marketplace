import { beforeEach, describe, expect, it, mock } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import NotificationMenu from '@/features/Notifications/Components/NotificationMenu.tsx'
import type useNotificationsLogic from '@/features/Notifications/Hooks/useNotificationsLogic.ts'
import {
    elements,
    findElement,
    invoke,
} from '@/tests/shared/RouteErrorComponent/renderHelpers.ts'

let logic: ReturnType<typeof useNotificationsLogic>
mock.module('@/language/useTranslationStore.ts', () => ({
    default: () => ({ t: (key: string) => key }),
}))
mock.module('@/features/Notifications/Hooks/useNotificationsLogic.ts', () => ({
    default: () => logic,
}))

beforeEach(() => {
    logic = {
        state: {
            activeTab: 'unread',
            dateFormatter: new Intl.DateTimeFormat('en-GB'),
            filteredNotifications: [],
            isLoading: false,
            isMarkingAllAsRead: false,
            markingNotificationId: null,
            unreadCount: 0,
            isOpen: true,
        },
        handler: {
            handleMarkAllAsRead: mock(),
            handleMarkAsRead: mock(),
            handleTabChange: mock(),
            handleToggle: mock(),
        },
        setter: { setIsOpen: mock() },
        refs: { notificationsRef: { current: null } },
    }
})

describe('NotificationMenu', () => {
    it('keeps the dialog hidden when closed and caps the unread badge at 99+', () => {
        logic.state.isOpen = false
        logic.state.unreadCount = 102
        const tree = NotificationMenu()
        const html = renderToStaticMarkup(tree)
        expect(html).toContain('aria-expanded="false"')
        expect(html).toContain('99+')
        expect(html).not.toContain('role="dialog"')
        invoke(
            findElement(
                tree,
                (element) => element.props['aria-haspopup'] === 'dialog',
            ),
            'onClick',
        )
        expect(logic.handler.handleToggle).toHaveBeenCalledTimes(1)
    })

    it.each(['unread', 'read'] as const)(
        'shows the %s empty state with mark-all disabled',
        (activeTab) => {
            logic.state.activeTab = activeTab
            const tree = NotificationMenu()
            const html = renderToStaticMarkup(tree)
            expect(html).toContain('role="dialog"')
            expect(html).toContain(`notifications.empty.${activeTab}.title`)
            expect(html).toContain(
                `notifications.empty.${activeTab}.description`,
            )
            expect(
                findElement(
                    tree,
                    (element) =>
                        element.props.onClick ===
                        logic.handler.handleMarkAllAsRead,
                ).props.disabled,
            ).toBe(true)
            const tabs = elements(tree).filter(
                (element) =>
                    element.type === 'button' &&
                    typeof element.props.children === 'string' &&
                    element.props.children.startsWith('notifications.tabs.'),
            )
            for (const tab of tabs) invoke(tab, 'onClick')
            expect(logic.handler.handleTabChange).toHaveBeenCalledWith('unread')
            expect(logic.handler.handleTabChange).toHaveBeenCalledWith('read')
        },
    )

    it('shows loading instead of an empty or populated list', () => {
        logic.state.isLoading = true
        const html = renderToStaticMarkup(NotificationMenu())
        expect(html).toContain('animate-spin')
        expect(html).not.toContain('notifications.empty')
        expect(html).not.toContain('<article')
    })

    it('renders unread and read messages with machine-readable timestamps and mark-read actions', () => {
        logic.state.unreadCount = 2
        logic.state.filteredNotifications = [
            {
                id: 'n-1',
                title: 'Backup finished',
                message: 'Archive is ready',
                type: 'info',
                referenceId: null,
                readAt: null,
                createdAt: '2026-01-02T12:00:00Z',
                isRead: false,
            },
            {
                id: 'n-2',
                title: 'Previously read',
                message: 'Older event',
                type: 'info',
                referenceId: null,
                readAt: '2026-01-01T13:00:00Z',
                createdAt: '2026-01-01T12:00:00Z',
                isRead: true,
            },
        ]
        const tree = NotificationMenu()
        const html = renderToStaticMarkup(tree)
        expect(html).toContain('Backup finished')
        expect(html).toContain('Archive is ready')
        expect(html).toContain('Previously read')
        expect(html).toContain('dateTime="2026-01-02T12:00:00Z"')
        const markRead = elements(tree).filter(
            (element) =>
                element.type === 'button' &&
                element.props['aria-label'] === 'notifications.markRead',
        )
        expect(markRead).toHaveLength(1)
        invoke(markRead[0]!, 'onClick')
        invoke(
            findElement(
                tree,
                (element) =>
                    element.props.onClick === logic.handler.handleMarkAllAsRead,
            ),
            'onClick',
        )
        expect(logic.handler.handleMarkAsRead).toHaveBeenCalledWith('n-1')
        expect(logic.handler.handleMarkAllAsRead).toHaveBeenCalledTimes(1)
        logic.state.markingNotificationId = 'n-1'
        logic.state.isMarkingAllAsRead = true
        const pending = NotificationMenu()
        expect(
            findElement(
                pending,
                (element) =>
                    element.type === 'button' &&
                    element.props['aria-label'] === 'notifications.markRead',
            ).props.disabled,
        ).toBe(true)
        expect(
            findElement(
                pending,
                (element) =>
                    element.props.onClick === logic.handler.handleMarkAllAsRead,
            ).props.disabled,
        ).toBe(true)
    })
})
