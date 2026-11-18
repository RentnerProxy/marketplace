import { beforeEach, describe, expect, it, vi } from 'bun:test'
import {
    appError,
    client,
    error,
    render,
    reset,
    settle,
    success,
} from '../UserManagement/user-management-hooks.test.helpers.ts'
import { PERMISSIONS } from '@/config/permissions.config.ts'
import { PERMISSION_MANAGEMENT_OVERVIEW_QUERY_KEY as overviewKey } from '@/lib/Permissions/permissionManagementCache.ts'
import type {
    PermissionManagementOverview,
    PermissionPreset,
} from '@/features/Admin/PermissionManagement/Types/permission-management-domain.types.ts'

const create = vi.fn()
const update = vi.fn()
const remove = vi.fn()
vi.mock('@rentnerkev/toasts', () => ({ toast: { success, error } }))
vi.mock('@/features/Admin/PermissionManagement/middleware.ts', () => ({
    createPermissionPresetHandler: create,
    updatePermissionPresetHandler: update,
    deletePermissionPresetHandler: remove,
}))
import usePermissionPresets from '@/features/Admin/PermissionManagement/Hooks/usePermissionPresets.ts'

const preset: PermissionPreset = {
    id: 'preset',
    name: 'Readers',
    description: 'Read access',
    permissionKeys: [PERMISSIONS.USER_DASHBOARD],
    createdAt: '2026-01-01',
    updatedAt: '2026-01-01',
}
const other = { ...preset, id: 'other', name: 'Other' }
const usePresets = () => usePermissionPresets({ presets: [preset, other] })
const cached = () =>
    client.getQueryData<PermissionManagementOverview>(overviewKey)

beforeEach(() => {
    reset()
    create.mockReset().mockResolvedValue({ success: true, preset })
    update.mockReset().mockResolvedValue({
        success: true,
        preset: { ...preset, name: 'Updated' },
    })
    remove.mockReset().mockResolvedValue({ success: true })
    client.setQueryData(overviewKey, {
        permissions: [],
        presets: [other],
    })
})

describe('permission presets', () => {
    it('creates a preset with sanitized permissions, updates cache and clears the submitted draft', async () => {
        let hook = render(usePresets)
        hook.handler.handleFieldChange('name', 'Readers')
        hook.handler.handleFieldChange('description', 'Read access')
        hook.handler.handleTogglePermission(PERMISSIONS.USER_DASHBOARD)
        hook.handler.handleTogglePermission(PERMISSIONS.ADMIN_DASHBOARD)
        hook.handler.handleTogglePermission(PERMISSIONS.ADMIN_DASHBOARD)
        hook.handler.handleTogglePermission(PERMISSIONS.ADMIN_SUPER_USER)
        hook = render(usePresets)
        hook.handler.handleSubmit()
        expect(render(usePresets).state.isSaving).toBe(true)
        await settle()
        expect(create).toHaveBeenCalledWith({
            data: {
                name: 'Readers',
                description: 'Read access',
                permissionKeys: [PERMISSIONS.USER_DASHBOARD],
            },
        })
        expect(cached()?.presets).toEqual([other, preset])
        expect(render(usePresets).state.formValues.name).toBe('')
        expect(success).toHaveBeenCalledWith(
            'admin.permissions.presets.created',
            { title: 'admin.permissions.title' },
        )
    })

    it('edits an existing preset, replaces its cache entry and removes super-user permission from the form', async () => {
        client.setQueryData(overviewKey, {
            ...cached(),
            presets: [preset, other],
        })
        render(usePresets).handler.handleStartEdit({
            ...preset,
            permissionKeys: [
                ...preset.permissionKeys,
                PERMISSIONS.ADMIN_SUPER_USER,
            ],
        })
        let hook = render(usePresets)
        expect(hook.state.formValues.permissionKeys).toEqual(
            preset.permissionKeys,
        )
        hook.handler.handleFieldChange('name', 'Updated')
        hook = render(usePresets)
        hook.handler.handleSubmit()
        await settle()
        expect(update).toHaveBeenCalledWith({
            data: {
                id: preset.id,
                name: 'Updated',
                description: preset.description,
                permissionKeys: preset.permissionKeys,
            },
        })
        expect(cached()?.presets.map((entry) => entry.name)).toEqual([
            'Updated',
            'Other',
        ])
        expect(render(usePresets).state.formValues.id).toBeNull()
        expect(success).toHaveBeenCalledWith(
            'admin.permissions.presets.updated',
            { title: 'admin.permissions.title' },
        )
    })

    it('preserves a new draft typed while an earlier save was pending', async () => {
        render(usePresets).handler.handleStartEdit(preset)
        const hook = render(usePresets)
        hook.handler.handleSubmit()
        hook.handler.handleFieldChange('name', 'Next draft')
        await settle()
        expect(render(usePresets).state.formValues.name).toBe('Next draft')
        render(usePresets).handler.handleStartCreate()
        expect(render(usePresets).state.formValues).toEqual({
            id: null,
            name: '',
            description: '',
            permissionKeys: [],
        })
    })

    it('cancels deletion, then removes the confirmed preset and its open edit draft', async () => {
        client.setQueryData(overviewKey, {
            ...cached(),
            presets: [preset, other],
        })
        let hook = render(usePresets)
        hook.handler.handleConfirmDelete()
        hook.handler.handleAskDelete(preset)
        hook = render(usePresets)
        expect(hook.state.deleteTarget).toEqual(preset)
        hook.handler.handleCloseDeleteModal()
        render(usePresets).handler.handleConfirmDelete()
        expect(remove).not.toHaveBeenCalled()
        hook.handler.handleStartEdit(preset)
        hook.handler.handleAskDelete(preset)
        render(usePresets).handler.handleConfirmDelete()
        expect(render(usePresets).state.isDeleting).toBe(true)
        await settle()
        expect(remove).toHaveBeenCalledWith({ data: { id: preset.id } })
        hook = render(usePresets)
        expect(hook.state.deleteTarget).toBeNull()
        expect(hook.state.formValues.id).toBeNull()
        expect(cached()?.presets).toEqual([other])
    })

    it('keeps unrelated edit drafts when deleting and tolerates an absent overview cache', async () => {
        client.clear()
        const hook = render(usePresets)
        hook.handler.handleStartEdit(other)
        hook.handler.handleAskDelete(preset)
        render(usePresets).handler.handleConfirmDelete()
        await settle()
        expect(render(usePresets).state.formValues.id).toBe(other.id)
        expect(cached()).toBeUndefined()
        render(usePresets).handler.handleSubmit()
        await settle()
        expect(cached()).toBeUndefined()
    })

    it.each(['save-rejected', 'save-error', 'delete-rejected', 'delete-error'])(
        'preserves the draft and reports %s',
        async (scenario) => {
            const deleting = scenario.startsWith('delete')
            const adapter = deleting ? remove : update
            if (scenario.endsWith('rejected'))
                adapter.mockResolvedValue({
                    success: false,
                    error: { code: 'FORBIDDEN', message: 'Denied' },
                })
            else adapter.mockRejectedValue(new Error('offline'))
            const originalCache = cached()
            const hook = render(usePresets)
            hook.handler.handleStartEdit(preset)
            hook.handler.handleAskDelete(preset)
            const editing = render(usePresets)
            if (deleting) editing.handler.handleConfirmDelete()
            else editing.handler.handleSubmit()
            await settle()
            expect(render(usePresets).state.formValues.id).toBe(preset.id)
            expect(cached()).toEqual(originalCache)
            expect(success).not.toHaveBeenCalled()
            if (scenario.endsWith('rejected'))
                expect(appError).toHaveBeenCalledTimes(1)
            else
                expect(error).toHaveBeenCalledWith('offline', {
                    title: 'common.error',
                })
        },
    )
})
