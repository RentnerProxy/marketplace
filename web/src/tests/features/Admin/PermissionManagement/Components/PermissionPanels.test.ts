import { describe, expect, it, mock } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import DefaultPermissionsPanel from '@/features/Admin/PermissionManagement/Components/DefaultPermissionsPanel.tsx'
import PermissionChecklist from '@/features/Admin/PermissionManagement/Components/PermissionChecklist.tsx'
import PermissionPresetForm from '@/features/Admin/PermissionManagement/Components/PermissionPresetForm.tsx'
import PermissionPresetList from '@/features/Admin/PermissionManagement/Components/PermissionPresetList.tsx'
import PermissionPresetsPanel from '@/features/Admin/PermissionManagement/Components/PermissionPresetsPanel.tsx'
import PermissionManagementTabs from '@/features/Admin/PermissionManagement/Components/PermissionManagementTabs.tsx'
import type {
    PermissionPresetsPanelProps,
    PermissionPresetFormProps,
} from '@/features/Admin/PermissionManagement/Types/permission-management-component-props.types.ts'
import type {
    PermissionManagementPermission,
    PermissionPreset,
} from '@/features/Admin/PermissionManagement/Types/permission-management-domain.types.ts'
import { PERMISSIONS } from '@/config/permissions.config.ts'
import {
    elements,
    findElement,
    invoke,
} from '@/tests/shared/RouteErrorComponent/renderHelpers.ts'

mock.module('@/language/useTranslationStore.ts', () => ({
    default: () => ({
        t: (key: string, values?: Record<string, unknown>) =>
            key + (values ? JSON.stringify(values) : ''),
    }),
}))
const permissions: Array<PermissionManagementPermission> = [
    {
        id: 'permission-1',
        key: PERMISSIONS.ADMIN_SUPER_USER,
        name: 'Super user',
        description: 'All access',
    },
    {
        id: 'permission-2',
        key: 'custom.read',
        name: 'Custom read',
        description: 'Read custom data',
    },
]
const preset: PermissionPreset = {
    id: 'preset-1',
    name: 'Support team',
    description: 'Help customers',
    permissionKeys: [PERMISSIONS.ADMIN_SUPER_USER, 'custom.read'],
    createdAt: '2026-01-01',
    updatedAt: '2026-01-01',
}

function formProps(): PermissionPresetFormProps {
    return {
        permissions,
        isLoading: false,
        formValues: {
            id: null,
            name: 'Support team',
            description: 'Help customers',
            permissionKeys: ['custom.read'],
        },
        isSaving: false,
        onFieldChange: mock(),
        onTogglePermission: mock(),
        onSubmit: mock(),
        onCancelEdit: mock(),
    }
}

describe('Permission checklist and defaults', () => {
    it('renders loading and empty states without actionable checkboxes', () => {
        for (const isLoading of [true, false]) {
            const html = renderToStaticMarkup(
                PermissionChecklist({
                    permissions: [],
                    selectedPermissionKeys: [],
                    isLoading,
                    onTogglePermission: mock(),
                }),
            )
            expect(html).toContain(
                `admin.permissions.checklist.${isLoading ? 'loading' : 'empty'}`,
            )
            expect(html).not.toContain('checkbox')
        }
    })

    it('labels inherited and privileged permissions and forwards toggles for the correct key', () => {
        const onTogglePermission = mock()
        const tree = PermissionChecklist({
            permissions,
            selectedPermissionKeys: [PERMISSIONS.ADMIN_SUPER_USER],
            presetPermissionKeys: ['custom.read'],
            isLoading: false,
            disabled: true,
            onTogglePermission,
        })
        const html = renderToStaticMarkup(tree)
        expect(html).toContain('admin.permissions.catalog.superUser.name')
        expect(html).toContain('admin.permissions.checklist.superUser')
        expect(html).toContain('admin.permissions.users.presetApplied')
        expect(html).toContain('Custom read')
        expect(html).toContain('Read custom data')
        const inputs = elements(tree).filter(
            (element) => element.type === 'input',
        )
        expect(inputs[0]!.props.checked).toBe(true)
        expect(inputs[1]!.props.checked).toBe(false)
        expect(inputs.every((element) => element.props.disabled)).toBe(true)
        invoke(inputs[1]!, 'onChange')
        expect(onTogglePermission).toHaveBeenCalledWith('custom.read')
    })

    it('allows only dirty, loaded, non-saving defaults to be saved', () => {
        const handler = { handleTogglePermission: mock(), handleSave: mock() }
        for (const [isDirty, isLoading, isSaving] of [
            [true, false, false],
            [false, false, false],
            [true, true, false],
            [true, false, true],
        ]) {
            const tree = DefaultPermissionsPanel({
                permissions,
                isLoading,
                state: {
                    permissionKeys: ['custom.read'],
                    isDirty,
                    isSaving,
                },
                handler,
            })
            const save = findElement(
                tree,
                (element) => element.type === 'button',
            )
            expect(save.props.disabled).toBe(!isDirty || isLoading || isSaving)
            const html = renderToStaticMarkup(tree)
            expect(html).toContain('admin.permissions.defaults.hint')
            if (isSaving) expect(html).toContain('common.saving')
            if (!save.props.disabled) invoke(save, 'onClick')
        }
        expect(handler.handleSave).toHaveBeenCalledTimes(1)
    })
})

describe('Permission presets', () => {
    it('renders preset fields and converts browser submission to its explicit handler', () => {
        const props = formProps()
        const tree = PermissionPresetForm(props)
        const html = renderToStaticMarkup(tree)
        expect(html).toContain('admin.permissions.presets.createTitle')
        expect(html).not.toContain('common.cancel')
        const name = findElement(
            tree,
            (element) =>
                element.props.label === 'admin.permissions.presets.nameLabel',
        )
        expect(name.props).toMatchObject({
            required: true,
            minLength: 2,
            maxLength: 100,
        })
        invoke(name, 'onChange', { target: { value: 'New preset' } })
        invoke(
            findElement(
                tree,
                (element) =>
                    element.props.label ===
                    'admin.permissions.presets.descriptionLabel',
            ),
            'onChange',
            { target: { value: 'New description' } },
        )
        expect(props.onFieldChange).toHaveBeenCalledWith('name', 'New preset')
        expect(props.onFieldChange).toHaveBeenCalledWith(
            'description',
            'New description',
        )
        const preventDefault = mock()
        invoke(
            findElement(tree, (element) => element.type === 'form'),
            'onSubmit',
            { preventDefault },
        )
        expect(preventDefault).toHaveBeenCalledTimes(1)
        expect(props.onSubmit).toHaveBeenCalledTimes(1)
    })

    it('supports edit cancellation and blocks blank, loading or pending submissions', () => {
        const props = formProps()
        props.formValues.id = preset.id
        const tree = PermissionPresetForm(props)
        expect(renderToStaticMarkup(tree)).toContain(
            'admin.permissions.presets.editTitle',
        )
        invoke(
            findElement(
                tree,
                (element) => element.props.onClick === props.onCancelEdit,
            ),
            'onClick',
        )
        expect(props.onCancelEdit).toHaveBeenCalledTimes(1)
        for (const [name, isLoading, isSaving] of [
            ['  ', false, false],
            ['Support', true, false],
            ['Support', false, true],
        ] as const) {
            const rendered = PermissionPresetForm({
                ...props,
                formValues: { ...props.formValues, name },
                isLoading,
                isSaving,
            })
            expect(
                findElement(
                    rendered,
                    (element) => element.props.type === 'submit',
                ).props.disabled,
            ).toBe(true)
            if (isSaving)
                expect(renderToStaticMarkup(rendered)).toContain(
                    'common.saving',
                )
        }
    })

    it('renders an empty list and excludes super-user permission from preset counts', () => {
        const callbacks = {
            onStartCreate: mock(),
            onStartEdit: mock(),
            onAskDelete: mock(),
        }
        expect(
            renderToStaticMarkup(
                PermissionPresetList({ presets: [], ...callbacks }),
            ),
        ).toContain('admin.permissions.presets.empty')
        const tree = PermissionPresetList({
            presets: [preset, { ...preset, id: 'preset-2', description: '' }],
            ...callbacks,
        })
        const html = renderToStaticMarkup(tree)
        expect(html).toContain('Help customers')
        expect(html).toContain('admin.permissions.presets.noDescription')
        expect(html).toContain('&quot;count&quot;:1')
        invoke(
            findElement(
                tree,
                (element) => element.props.onClick === callbacks.onStartCreate,
            ),
            'onClick',
        )
        invoke(
            findElement(
                tree,
                (element) =>
                    element.props['aria-label'] ===
                    'admin.permissions.presets.editAriaLabel',
            ),
            'onClick',
        )
        invoke(
            findElement(
                tree,
                (element) =>
                    element.props['aria-label'] ===
                    'admin.permissions.presets.deleteAriaLabel',
            ),
            'onClick',
        )
        expect(callbacks.onStartCreate).toHaveBeenCalledTimes(1)
        expect(callbacks.onStartEdit).toHaveBeenCalledWith(preset)
        expect(callbacks.onAskDelete).toHaveBeenCalledWith(preset)
    })

    it('connects delete confirmation to the selected preset and forwards close/confirm', () => {
        const props: PermissionPresetsPanelProps = {
            permissions,
            isLoading: false,
            state: {
                formValues: formProps().formValues,
                presets: [preset],
                deleteTarget: preset,
                isSaving: false,
                isDeleting: true,
            },
            handler: {
                handleFieldChange: mock(),
                handleTogglePermission: mock(),
                handleSubmit: mock(),
                handleStartCreate: mock(),
                handleStartEdit: mock(),
                handleAskDelete: mock(),
                handleCloseDeleteModal: mock(),
                handleConfirmDelete: mock(),
            },
        }
        const tree = PermissionPresetsPanel(props)
        const modal = findElement(
            tree,
            (element) =>
                element.props.onConfirm === props.handler.handleConfirmDelete,
        )
        expect(modal.props).toMatchObject({ isOpen: true, isConfirming: true })
        expect(modal.props.question).toContain('Support team')
        invoke(modal, 'onClose')
        invoke(modal, 'onConfirm')
        expect(props.handler.handleCloseDeleteModal).toHaveBeenCalledTimes(1)
        expect(props.handler.handleConfirmDelete).toHaveBeenCalledTimes(1)
        props.state.deleteTarget = null
        expect(
            findElement(
                PermissionPresetsPanel(props),
                (element) =>
                    element.props.onConfirm ===
                    props.handler.handleConfirmDelete,
            ).props.isOpen,
        ).toBe(false)
    })

    it('provides the three management tabs and forwards tab selection', () => {
        const onTabChange = mock()
        const tree = PermissionManagementTabs({
            activeTab: 'presets',
            onTabChange,
        })
        const html = renderToStaticMarkup(tree)
        for (const tab of ['defaults', 'presets', 'users'])
            expect(html).toContain(`admin.permissions.tabs.${tab}`)
        expect(tree.props.activeTab).toBe('presets')
        invoke(tree, 'onTabChange', 'users')
        expect(onTabChange).toHaveBeenCalledWith('users')
    })
})
