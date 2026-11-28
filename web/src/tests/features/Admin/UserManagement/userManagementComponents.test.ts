import { beforeEach, afterEach, describe, expect, it, vi } from 'bun:test'
import * as ReactDOM from 'react-dom'
import { createElement, isValidElement } from 'react'
import type { ReactElement, ReactNode, SubmitEvent } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { render, reset } from './user-management-hooks.test.helpers.ts'
import {
    restoreTestGlobals,
    stubTestGlobal,
} from '@/tests/shared/bunTestStubs.ts'
import type { UpdateUserFormValues } from '@/features/Admin/UserManagement/Types/user-management-form.types.ts'

const input = ({
    value,
    placeholder,
}: {
    value?: string
    placeholder?: string
}) => createElement('input', { value, placeholder, readOnly: true })
vi.mock('@rentnerkev/inputs', () => ({ TextInput: input, EmailInput: input }))
vi.mock('@rentnerkev/tooltips', () => ({
    CustomTooltip: ({ children }: { children: ReactNode }) => children,
}))
vi.mock('react-dom', () => ({
    ...ReactDOM,
    createPortal: (children: ReactNode) => children,
}))
vi.mock('@/shared/Images/Hooks/useLocalProfileImageVersion.ts', () => ({
    default: () => 42,
}))
const imageError = vi.fn()
vi.mock('@/shared/Images/Hooks/useResolvedImageSrc.ts', () => ({
    default: () => ({
        state: { imageSrc: '/synthetic-avatar.png' },
        handler: { handleImageError: imageError },
    }),
}))
import GeneralUserInfo from '@/features/Admin/UserManagement/Components/UserEditModal/Components/GeneralUserInfo.tsx'
import Header from '@/features/Admin/UserManagement/Components/UserEditModal/Components/Header.tsx'
import Footer from '@/features/Admin/UserManagement/Components/UserEditModal/Components/Footer.tsx'
import UserAvatar from '@/features/Admin/UserManagement/Components/UserAvatar.tsx'
import { ActionMenu } from '@/shared/ActionMenu/index.tsx'
import UserTableActions from '@/features/Admin/UserManagement/Components/UsersTable/Components/UserTableActions.tsx'
import useUserEditModalLogic from '@/features/Admin/UserManagement/Components/UserEditModal/Hooks/useUserEditModalLogic.ts'
const { default: EditUserModal } =
    await import('@/features/Admin/UserManagement/Components/UserEditModal/index.tsx')

function elements(
    node: ReactNode,
): Array<ReactElement<Record<string, unknown>>> {
    if (Array.isArray(node)) return node.flatMap(elements)
    if (!isValidElement<Record<string, unknown>>(node)) return []
    return [node, ...elements(node.props.children as ReactNode)]
}

function invoke(
    element: ReactElement<Record<string, unknown>> | undefined,
    name: string,
    ...args: Array<unknown>
) {
    const callback = element?.props[name]
    if (typeof callback !== 'function')
        throw new Error(`Missing ${name} callback`)
    return callback(...args)
}

const values: UpdateUserFormValues = {
    id: 'member',
    username: 'Ada',
    email: 'ada@example.invalid',
}

beforeEach(() => {
    reset()
    stubTestGlobal('document', { body: {} })
})
afterEach(restoreTestGlobals)

describe('user edit draft', () => {
    it('submits current draft values and restores the source when reopening or switching users', () => {
        const onSubmit = vi.fn()
        let isOpen = true
        let editForm = values
        const useDraft = () =>
            useUserEditModalLogic({ editForm, isOpen, onSubmit })
        let hook = render(useDraft)
        hook.handler.handleFieldChange('username', 'Draft')
        hook = render(useDraft)
        const preventDefault = vi.fn()
        hook.handler.handleSubmit({
            preventDefault,
        } as unknown as SubmitEvent<HTMLFormElement>)
        expect(preventDefault).toHaveBeenCalledTimes(1)
        expect(onSubmit).toHaveBeenCalledWith({ ...values, username: 'Draft' })
        isOpen = false
        render(useDraft)
        isOpen = true
        render(useDraft)
        expect(render(useDraft).state.draftForm.username).toBe('Ada')
        editForm = { ...values, id: 'other', username: 'Grace' }
        render(useDraft)
        expect(render(useDraft).state.draftForm.username).toBe('Grace')
    })
})

describe('user management components', () => {
    it('renders the edit dialog only while open and disables saving during an update', () => {
        const onClose = vi.fn()
        const onSubmit = vi.fn()
        expect(
            render(() =>
                EditUserModal({
                    isOpen: false,
                    editForm: values,
                    isUpdatingUser: false,
                    onClose,
                    onSubmit,
                }),
            ),
        ).toBeNull()
        render(() =>
            EditUserModal({
                isOpen: true,
                editForm: values,
                isUpdatingUser: true,
                onClose,
                onSubmit,
            }),
        )
        const dialog = render(() =>
            EditUserModal({
                isOpen: true,
                editForm: values,
                isUpdatingUser: true,
                onClose,
                onSubmit,
            }),
        )
        const html = renderToStaticMarkup(dialog)
        expect(html).toContain('marketplace-signed-in')
        expect(html).toContain('marketplace-dialog-panel')
        expect(html).toContain('admin.users.editTitle')
        expect(html).toContain('ada@example.invalid')
        expect(html).toContain('common.saving')
        expect(html).toContain('disabled=""')
        const form = elements(dialog).find((element) => element.type === 'form')
        const preventDefault = vi.fn()
        invoke(form, 'onSubmit', { preventDefault })
        expect(onSubmit).toHaveBeenCalledWith(values)
    })

    it('wires every account input to the matching edit field', () => {
        const onFieldChange = vi.fn()
        const tree = GeneralUserInfo({ draftForm: values, onFieldChange })
        const fields = elements(tree).filter(
            (element) => typeof element.props.onValueChange === 'function',
        )
        expect(fields).toHaveLength(2)
        fields.forEach((field, index) => {
            invoke(field, 'onValueChange', `changed-${index}`)
        })
        expect(onFieldChange.mock.calls).toEqual([
            ['username', 'changed-0'],
            ['email', 'changed-1'],
        ])
    })

    it('offers accessible close/cancel controls and the normal save label', () => {
        const onClose = vi.fn()
        const header = Header({ onClose })
        const close = elements(header).find(
            (element) => element.type === 'button',
        )
        expect(close?.props['aria-label']).toBe(
            'admin.users.closeModalAriaLabel',
        )
        invoke(close, 'onClick')
        const footer = Footer({ isUpdatingUser: false, onClose })
        expect(renderToStaticMarkup(footer)).toContain('common.save')
        const cancel = elements(footer).find(
            (element) => element.props.type === 'button',
        )
        invoke(cancel, 'onClick')
        expect(onClose).toHaveBeenCalledTimes(2)
    })

    it('renders resolved avatar images with an accessible label and image recovery callback', () => {
        const tree = UserAvatar({
            userId: 'member',
            username: 'Ada',
            profileImageVersion: null,
        })
        const image = elements(tree).find((element) => element.type === 'img')
        expect(image?.props.src).toBe('/synthetic-avatar.png')
        expect(image?.props.alt).toBe('Ada Profilbild')
        invoke(image, 'onError')
        expect(imageError).toHaveBeenCalledTimes(1)
    })

    it('provides one row action menu with labeled items and the matching callbacks', () => {
        const callbacks = {
            onEditUser: vi.fn(),
            onDeleteUser: vi.fn(),
            onToggleUserActive: vi.fn(),
            onPasswordReset: vi.fn(),
        }
        const user: Parameters<typeof UserTableActions>[0]['user'] = {
            ...values,
            isActive: true,
            isCurrentUser: false,
            isSuperUser: false,
            permissions: [],
            createdAt: '2026-01-01T00:00:00Z',
            profileImageVersion: null,
        }
        const props = {
            ...callbacks,
            user,
            accountType: 'public' as const,
            isDeletingUser: false,
            isTogglingUserActive: false,
            isResendingPasswordReset: false,
            isConvertingAccount: false,
            canManageSuperUsers: false,
            canConvertAccounts: false,
            onConvertAccount: vi.fn(),
        }
        const menu = UserTableActions(props)
        expect(menu.type).toBe(ActionMenu)
        const { items } = menu.props as Parameters<typeof ActionMenu>[0]
        expect(items.map((item) => item.label)).toEqual([
            'admin.users.editAriaLabel',
            'common.deactivate',
            'admin.users.passwordResetAriaLabel',
            'admin.users.deleteAriaLabel',
        ])
        expect(
            items
                .filter((item) => 'destructive' in item && item.destructive)
                .map((item) => item.id),
        ).toEqual(['delete'])
        expect(items.every((item) => !item.disabled)).toBe(true)
        for (const item of items) {
            if (!item.onSelect)
                throw new Error(`Expected callback for ${item.id}`)
            item.onSelect()
        }
        for (const callback of Object.values(callbacks))
            expect(callback).toHaveBeenCalledWith(user)

        const blocked = UserTableActions({
            ...props,
            canConvertAccounts: true,
            user: { ...user, isSuperUser: true },
        }).props as Parameters<typeof ActionMenu>[0]
        expect(blocked.items).toHaveLength(4)
        expect(
            blocked.items.every((item) => item.disabled && item.description),
        ).toBe(true)

        const inactive = UserTableActions({
            ...props,
            user: { ...user, isActive: false },
            canConvertAccounts: true,
            isConvertingAccount: true,
        }).props as Parameters<typeof ActionMenu>[0]
        expect(
            inactive.items.find((item) => item.id === 'toggle-status'),
        ).toMatchObject({ label: 'common.activate', disabled: false })
        expect(
            inactive.items
                .filter((item) => item.disabled)
                .map((item) => item.id),
        ).toEqual(['password-reset', 'convert-account'])
    })
})
