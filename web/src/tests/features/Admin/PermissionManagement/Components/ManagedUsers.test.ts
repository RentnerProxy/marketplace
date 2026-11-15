import { describe, expect, it, mock } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import ManagedUsersList from '@/features/Admin/PermissionManagement/Components/ManagedUsersList.tsx'
import ManagedUserPermissionEditor from '@/features/Admin/PermissionManagement/Components/ManagedUserPermissionEditor.tsx'
import UserPermissionsPanel from '@/features/Admin/PermissionManagement/Components/UserPermissionsPanel.tsx'
import type {
    ManagedUsersListProps,
    ManagedUserPermissionEditorProps,
} from '@/features/Admin/PermissionManagement/Types/permission-management-component-props.types.ts'
import type {
    PermissionManagementUser,
    PermissionPreset,
} from '@/features/Admin/PermissionManagement/Types/permission-management-domain.types.ts'
import {
    findElement,
    invoke,
} from '@/tests/shared/RouteErrorComponent/renderHelpers.ts'

mock.module('@/language/useTranslationStore.ts', () => ({
    default: () => ({
        t: (key: string, values?: Record<string, unknown>) =>
            key + (values ? JSON.stringify(values) : ''),
    }),
}))

const user: PermissionManagementUser = {
    id: 'u-1',
    username: 'Kevin',
    email: 'kevin@example.test',
    firstName: null,
    lastName: null,
    isActive: false,
    isSuperUser: true,
    isCurrentUser: true,
    permissions: ['users.read'],
}
const preset: PermissionPreset = {
    id: 'p-1',
    name: 'Support team',
    description: 'Read access',
    permissionKeys: ['users.read'],
    createdAt: '2026-01-01',
    updatedAt: '2026-01-01',
}
function listProps(): ManagedUsersListProps {
    return {
        state: {
            users: [
                user,
                {
                    ...user,
                    id: 'u-2',
                    username: 'Other',
                    isActive: true,
                    isSuperUser: false,
                },
            ],
            total: 21,
            searchInput: 'Kevin',
            pageIndex: 1,
            pageCount: 3,
            canGoPrevious: true,
            canGoNext: true,
            isLoading: false,
            isError: false,
            selectedUser: user,
            permissionKeys: [],
            appliedPresets: [],
            presetPermissionKeys: [],
            selectedPresetId: '',
            isDirty: false,
            isSaving: false,
        },
        handler: {
            handleSearchInputChange: mock(),
            handlePreviousPage: mock(),
            handleNextPage: mock(),
            handleSelectUser: mock(),
            handleTogglePermission: mock(),
            handleSelectPreset: mock(),
            handleSave: mock(),
            handleRetry: mock(),
        },
    }
}
function editorProps(): ManagedUserPermissionEditorProps {
    return {
        permissions: [
            {
                id: 'permission-1',
                key: 'users.read',
                name: 'Read users',
                description: 'Browse user records',
            },
        ],
        presets: [preset],
        selectedUser: user,
        permissionKeys: ['users.read'],
        appliedPresets: [preset],
        presetPermissionKeys: ['users.read'],
        selectedPresetId: 'p-1',
        isDirty: true,
        isSaving: false,
        onTogglePermission: mock(),
        onSelectPreset: mock(),
        onSave: mock(),
    }
}

describe('ManagedUsersList', () => {
    it('composes the managed list and editor with shared selection and callbacks', () => {
        const props = listProps()
        const tree = UserPermissionsPanel({
            ...props,
            permissions: editorProps().permissions,
            presets: [preset],
        })
        const html = renderToStaticMarkup(tree)
        expect(html).toContain('admin.permissions.users.listTitle')
        expect(html).toContain('Read users')
        const editor = findElement(
            tree,
            (element) => element.type === ManagedUserPermissionEditor,
        )
        expect(editor.props.selectedUser).toBe(user)
        invoke(editor, 'onSave')
        expect(props.handler.handleSave).toHaveBeenCalledTimes(1)
    })
    it('renders selected and unselected users, role/status badges and pagination totals', () => {
        const html = renderToStaticMarkup(ManagedUsersList(listProps()))
        expect(html).toContain('aria-pressed="true"')
        expect(html).toContain('aria-pressed="false"')
        expect(html).toContain('kevin@example.test')
        expect(html).toContain('admin.permissions.users.superUser')
        expect(html).toContain('admin.permissions.users.inactive')
        expect(html).toContain('&quot;current&quot;:2')
        expect(html).toContain('&quot;count&quot;:21')
    })

    it.each(['error', 'loading', 'empty'] as const)(
        'renders the %s state without user rows',
        (mode) => {
            const props = listProps()
            props.state.users = []
            props.state.isError = mode === 'error'
            props.state.isLoading = mode === 'loading'
            const tree = ManagedUsersList(props)
            const html = renderToStaticMarkup(tree)
            expect(html).toContain(
                `admin.permissions.users.${mode === 'error' ? 'loadError' : mode}`,
            )
            expect(html).not.toContain('aria-pressed')
            if (mode === 'error') {
                invoke(
                    findElement(
                        tree,
                        (element) =>
                            element.type === 'button' &&
                            element.props.onClick === props.handler.handleRetry,
                    ),
                    'onClick',
                )
                expect(props.handler.handleRetry).toHaveBeenCalledTimes(1)
            }
        },
    )

    it('forwards search, selection and pagination actions', () => {
        const props = listProps()
        const tree = ManagedUsersList(props)
        invoke(
            findElement(tree, (element) => element.props.maxLength === 200),
            'onChange',
            { target: { value: 'admin' } },
        )
        invoke(
            findElement(
                tree,
                (element) => element.props['aria-pressed'] === false,
            ),
            'onClick',
        )
        invoke(
            findElement(
                tree,
                (element) =>
                    element.props['aria-label'] ===
                    'admin.permissions.users.previous',
            ),
            'onClick',
        )
        invoke(
            findElement(
                tree,
                (element) =>
                    element.props['aria-label'] ===
                    'admin.permissions.users.next',
            ),
            'onClick',
        )
        expect(props.handler.handleSearchInputChange).toHaveBeenCalledWith(
            'admin',
        )
        expect(props.handler.handleSelectUser).toHaveBeenCalledWith(
            props.state.users[1],
        )
        expect(props.handler.handlePreviousPage).toHaveBeenCalledTimes(1)
        expect(props.handler.handleNextPage).toHaveBeenCalledTimes(1)
    })

    it('disables pagination while loading and at page boundaries', () => {
        for (const loading of [true, false]) {
            const props = listProps()
            props.state.isLoading = loading
            props.state.canGoPrevious = false
            props.state.canGoNext = false
            const tree = ManagedUsersList(props)
            for (const direction of ['previous', 'next'])
                expect(
                    findElement(
                        tree,
                        (element) =>
                            element.props['aria-label'] ===
                            `admin.permissions.users.${direction}`,
                    ).props.disabled,
                ).toBe(true)
        }
    })
})

describe('ManagedUserPermissionEditor', () => {
    it('requests user selection before exposing editing controls', () => {
        const html = renderToStaticMarkup(
            ManagedUserPermissionEditor({
                ...editorProps(),
                selectedUser: null,
            }),
        )
        expect(html).toContain('admin.permissions.users.noSelectionTitle')
        expect(html).not.toContain('admin.permissions.users.save')
    })

    it('shows user identity, inherited presets and checked permissions', () => {
        const html = renderToStaticMarkup(
            ManagedUserPermissionEditor(editorProps()),
        )
        expect(html).toContain('Kevin')
        expect(html).toContain('admin.permissions.users.currentUser')
        expect(html).toContain('admin.permissions.users.superUser')
        expect(html).toContain('Support team')
        expect(html).toContain('admin.permissions.users.unsavedChanges')
        expect(html).toContain('Read users')
    })

    it('shows no inherited presets and prevents clean or pending saves', () => {
        for (const isSaving of [false, true]) {
            const tree = ManagedUserPermissionEditor({
                ...editorProps(),
                selectedUser: {
                    ...user,
                    isCurrentUser: false,
                    isSuperUser: false,
                },
                appliedPresets: [],
                isDirty: false,
                isSaving,
            })
            const html = renderToStaticMarkup(tree)
            expect(html).toContain('admin.permissions.users.noAppliedPresets')
            expect(html).not.toContain('admin.permissions.users.unsavedChanges')
            expect(
                findElement(tree, (element) => element.type === 'button').props
                    .disabled,
            ).toBe(true)
            if (isSaving) expect(html).toContain('common.saving')
        }
    })

    it('wires save, preset selection and checklist permission changes', () => {
        const props = editorProps()
        const tree = ManagedUserPermissionEditor(props)
        invoke(
            findElement(tree, (element) => element.type === 'button'),
            'onClick',
        )
        invoke(
            findElement(
                tree,
                (element) =>
                    element.props.onValueChange === props.onSelectPreset,
            ),
            'onValueChange',
            'p-2',
        )
        invoke(
            findElement(
                tree,
                (element) =>
                    element.props.onTogglePermission ===
                    props.onTogglePermission,
            ),
            'onTogglePermission',
            'users.read',
        )
        expect(props.onSave).toHaveBeenCalledTimes(1)
        expect(props.onSelectPreset).toHaveBeenCalledWith('p-2')
        expect(props.onTogglePermission).toHaveBeenCalledWith('users.read')
    })
})
