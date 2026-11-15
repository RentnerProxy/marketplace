import { beforeEach, describe, expect, it, vi } from 'bun:test'
import {
    appError,
    client,
    error,
    query,
    render,
    reset,
    settle,
    success,
} from '../../UserManagement/user-management-hooks.test.helpers.ts'
import type { UseMaintenanceSettingsParams } from '@/features/Admin/SystemSettings/Types/system-settings-logic.types.ts'

const saveName = vi.fn()
const saveLogo = vi.fn()
const saveMaintenance = vi.fn()
const resolveRequest = vi.fn()
const complete = vi.fn()
const fail = vi.fn()
const transfer = vi.fn(() => ({ complete, fail }))
const dataUrl = 'data:image/png;base64,YQ=='
vi.mock('@rentnerkev/toasts', () => ({ toast: { success, error } }))
vi.mock('@/features/Admin/SystemSettings/middleware.ts', () => ({
    getAdminSystemSettingsHandler: vi.fn(),
    updateCompanyNameHandler: saveName,
    updateSystemLogoHandler: saveLogo,
    updateMaintenanceModeHandler: saveMaintenance,
    resolveMaintenanceExtensionRequestHandler: resolveRequest,
}))
vi.mock('@/shared/TransferOverlay/Hooks/useTransferOverlayTasks.ts', () => ({
    startTransferTask: transfer,
}))
vi.mock('@/lib/Images/readImageFileAsDataUrl.ts', () => ({
    readImageFileAsDataUrl: (_file: File, callback: (value: string) => void) =>
        callback(dataUrl),
}))
import useCompanyNameForm from '@/features/Admin/SystemSettings/Hooks/useCompanyNameForm.ts'
import useSystemLogoUpload from '@/features/Admin/SystemSettings/Hooks/useSystemLogoUpload.ts'
import useMaintenanceSettings from '@/features/Admin/SystemSettings/Hooks/useMaintenanceSettings.ts'
import useSystemSettingsLogic from '@/features/Admin/SystemSettings/Hooks/useSystemSettingsLogic.ts'

const queryKey = ['system-settings', 'admin']
const maintenanceParams: UseMaintenanceSettingsParams = {
    currentMaintenanceStartsAt: '2026-12-01T12:00:00Z',
    pendingMaintenanceExtensionRequest: {
        id: 'request',
        reason: 'Need time',
        requestedAt: '2026-11-01T12:00:00Z',
        user: { id: 'member', username: 'Ada' },
    },
}
const useName = () => useCompanyNameForm('Original')
const useMaintenance = () => useMaintenanceSettings(maintenanceParams)
const crop = { x: 2, y: 3, width: 40, height: 50 }

beforeEach(() => {
    reset()
    for (const adapter of [saveName, saveLogo, saveMaintenance, resolveRequest])
        adapter.mockReset().mockResolvedValue({ success: true })
    query.mockImplementation(() => ({ data: undefined }))
})

describe('company name form', () => {
    it('loads updated names and saves the edited value with query invalidation', async () => {
        let name: string | undefined
        const useForm = () => useCompanyNameForm(name)
        expect(render(useForm).state.companyName).toBe('')
        name = 'Remote'
        render(useForm)
        let hook = render(useForm)
        expect(hook.state.companyName).toBe('Remote')
        hook.handler.handleCompanyNameChange('Edited')
        hook = render(useForm)
        hook.handler.handleSaveCompanyName()
        expect(render(useForm).state.isSavingCompanyName).toBe(true)
        const invalidate = vi.spyOn(client, 'invalidateQueries')
        await settle()
        expect(saveName).toHaveBeenCalledWith({
            data: { companyName: 'Edited' },
        })
        expect(invalidate).toHaveBeenCalledWith({ queryKey })
        expect(success).toHaveBeenCalledWith(
            'admin.systemSettings.companyNameSaved',
            { title: 'admin.systemSettings.toastTitle' },
        )
        name = undefined
        render(useForm)
        expect(render(useForm).state.companyName).toBe('Edited')
        invalidate.mockRestore()
    })

    it.each(['rejected', 'network', 'unknown'])(
        'preserves the company name on %s failure',
        async (failure) => {
            if (failure === 'rejected')
                saveName.mockResolvedValue({ success: false, error: 'Denied' })
            else
                saveName.mockRejectedValue(
                    failure === 'network' ? new Error('offline') : null,
                )
            render(useName).handler.handleCompanyNameChange('Draft')
            render(useName).handler.handleSaveCompanyName()
            await settle()
            expect(render(useName).state.companyName).toBe('Draft')
            expect(success).not.toHaveBeenCalled()
            if (failure === 'rejected')
                expect(appError).toHaveBeenCalledTimes(1)
            else
                expect(error).toHaveBeenCalledWith(
                    failure === 'network'
                        ? 'offline'
                        : 'admin.systemSettings.companyNameSaveError',
                    { title: 'common.error' },
                )
        },
    )
})

describe('system logo upload', () => {
    it('requires an image and crop before making a request', async () => {
        render(useSystemLogoUpload).handler.handleSaveLogo()
        await settle()
        expect(saveLogo).not.toHaveBeenCalled()
        expect(transfer).not.toHaveBeenCalled()
        expect(appError).toHaveBeenCalledTimes(1)
        render(useSystemLogoUpload).handler.handleSelectLogo(
            new File(['a'], 'logo.png'),
        )
        render(useSystemLogoUpload).handler.handleSaveLogo()
        await settle()
        expect(saveLogo).not.toHaveBeenCalled()
    })

    it('uploads the selected crop, completes transfer progress and clears the selection on success', async () => {
        const invalidate = vi.spyOn(client, 'invalidateQueries')
        let hook = render(useSystemLogoUpload)
        hook.handler.handleSelectLogo(new File(['a'], 'logo.png'))
        hook.handler.handleCropChange({ x: 7, y: 8 })
        hook.handler.handleZoomChange(2)
        hook.handler.handleCropComplete(null, crop)
        hook = render(useSystemLogoUpload)
        expect(hook.state.crop).toEqual({ x: 7, y: 8 })
        expect(hook.state.zoom).toBe(2)
        hook.handler.handleSaveLogo()
        expect(render(useSystemLogoUpload).state.isSavingLogo).toBe(true)
        await settle()
        expect(saveLogo).toHaveBeenCalledWith({
            data: { imageDataUrl: dataUrl, crop },
        })
        expect(transfer).toHaveBeenCalledWith({
            direction: 'upload',
            title: 'admin.systemSettings.logoUploadTitle',
            totalBytes: 1,
        })
        expect(complete).toHaveBeenCalledWith(
            'admin.systemSettings.logoUploaded',
        )
        expect(fail).not.toHaveBeenCalled()
        expect(render(useSystemLogoUpload).state.selectedLogoDataUrl).toBeNull()
        expect(invalidate).toHaveBeenCalledWith({ queryKey })
        invalidate.mockRestore()
    })

    it.each(['rejected', 'network', 'unknown'])(
        'keeps the selected image after %s failure for retry or cancellation',
        async (failure) => {
            if (failure === 'rejected')
                saveLogo.mockResolvedValue({ success: false, error: 'Denied' })
            else
                saveLogo.mockRejectedValue(
                    failure === 'network' ? new Error('offline') : null,
                )
            const hook = render(useSystemLogoUpload)
            hook.handler.handleSelectLogo(new File(['a'], 'logo.png'))
            hook.handler.handleCropComplete(null, crop)
            render(useSystemLogoUpload).handler.handleSaveLogo()
            await settle()
            expect(render(useSystemLogoUpload).state.selectedLogoDataUrl).toBe(
                dataUrl,
            )
            expect(success).not.toHaveBeenCalled()
            if (failure === 'rejected')
                expect(appError).toHaveBeenCalledTimes(1)
            else {
                expect(fail).toHaveBeenCalledWith(
                    'admin.systemSettings.logoUploadFailed',
                )
                expect(error).toHaveBeenCalledWith(
                    failure === 'network'
                        ? 'offline'
                        : 'admin.systemSettings.logoSaveError',
                    { title: 'common.error' },
                )
            }
            render(useSystemLogoUpload).handler.handleResetSelectedLogo()
            expect(
                render(useSystemLogoUpload).state.selectedLogoDataUrl,
            ).toBeNull()
            expect(render(useSystemLogoUpload).state.zoom).toBe(1)
        },
    )
})

describe('maintenance settings responses', () => {
    it.each([true, false])(
        'handles successful maintenance enabled=%s and refreshes settings',
        async (enabled) => {
            saveMaintenance.mockResolvedValue({
                success: true,
                isMaintenanceModeEnabled: enabled,
            })
            const invalidate = vi.spyOn(client, 'invalidateQueries')
            const hook = render(useMaintenance)
            if (enabled) hook.handler.handleEnableMaintenanceMode()
            else hook.handler.handleDisableMaintenanceMode()
            expect(render(useMaintenance).state.isSavingMaintenanceMode).toBe(
                true,
            )
            await settle()
            expect(saveMaintenance).toHaveBeenCalledWith({
                data: enabled
                    ? {
                          isEnabled: true,
                          startsAt:
                              maintenanceParams.currentMaintenanceStartsAt,
                      }
                    : { isEnabled: false },
            })
            expect(success).toHaveBeenCalledWith(
                enabled
                    ? 'admin.systemSettings.maintenancePlanned'
                    : 'admin.systemSettings.maintenanceDisabled',
                { title: 'admin.systemSettings.toastTitle' },
            )
            expect(invalidate).toHaveBeenCalledWith({ queryKey })
            invalidate.mockRestore()
        },
    )

    it.each(['approved', 'rejected'] as const)(
        'resolves a maintenance extension as %s and refreshes settings',
        async (status) => {
            const invalidate = vi.spyOn(client, 'invalidateQueries')
            let hook = render(useMaintenance)
            hook.handler.handleMaintenanceExtensionMinutesChange(20)
            hook = render(useMaintenance)
            if (status === 'approved')
                hook.handler.handleApproveMaintenanceExtensionRequest()
            else hook.handler.handleRejectMaintenanceExtensionRequest()
            expect(
                render(useMaintenance).state
                    .isResolvingMaintenanceExtensionRequest,
            ).toBe(true)
            await settle()
            expect(resolveRequest).toHaveBeenCalledWith({
                data: {
                    requestId: 'request',
                    status,
                    extensionMinutes: status === 'approved' ? 20 : undefined,
                },
            })
            expect(success).toHaveBeenCalledWith(
                'admin.systemSettings.extensionRequestResolved',
                { title: 'admin.systemSettings.maintenanceToastTitle' },
            )
            expect(invalidate).toHaveBeenCalledWith({ queryKey })
            invalidate.mockRestore()
        },
    )

    it.each([
        'mode-rejected',
        'mode-network',
        'mode-unknown',
        'extension-rejected',
        'extension-network',
        'extension-unknown',
    ])('reports %s without a success notification', async (scenario) => {
        const extension = scenario.startsWith('extension')
        const adapter = extension ? resolveRequest : saveMaintenance
        if (scenario.endsWith('rejected'))
            adapter.mockResolvedValue({ success: false, error: 'Denied' })
        else
            adapter.mockRejectedValue(
                scenario.endsWith('network') ? new Error('offline') : null,
            )
        const hook = render(useMaintenance)
        if (extension) hook.handler.handleApproveMaintenanceExtensionRequest()
        else hook.handler.handleEnableMaintenanceMode()
        await settle()
        expect(success).not.toHaveBeenCalled()
        if (scenario.endsWith('rejected'))
            expect(appError).toHaveBeenCalledTimes(1)
        else
            expect(error).toHaveBeenCalledWith(
                scenario.endsWith('network')
                    ? 'offline'
                    : extension
                      ? 'admin.systemSettings.extensionRequestResolveError'
                      : 'admin.systemSettings.maintenanceSaveError',
                { title: 'common.error' },
            )
    })
})

describe('system settings composition', () => {
    it('supplies safe defaults while loading and passes the loaded configuration to its editors', () => {
        let hook = render(useSystemSettingsLogic)
        expect(hook.state.logoPreviewSrc).toBe('/favicon.ico')
        expect(hook.state.isMaintenanceModeEnabled).toBe(false)
        expect(hook.state.pendingMaintenanceExtensionRequest).toBeNull()
        query.mockImplementation(() => ({
            data: {
                companyName: 'Loaded company',
                logoSrc: '/logo.png',
                isMaintenanceModeEnabled: true,
                isMaintenanceModeActive: true,
                maintenanceStartsAt:
                    maintenanceParams.currentMaintenanceStartsAt,
                pendingMaintenanceExtensionRequest:
                    maintenanceParams.pendingMaintenanceExtensionRequest,
            },
        }))
        render(useSystemSettingsLogic)
        hook = render(useSystemSettingsLogic)
        expect(hook.state.companyName).toBe('Loaded company')
        expect(hook.state.logoPreviewSrc).toBe('/logo.png')
        expect(hook.state.isMaintenanceModeEnabled).toBe(true)
        expect(hook.state.maintenanceStartsAt).toBe(
            maintenanceParams.currentMaintenanceStartsAt ?? undefined,
        )
        hook.handler.handleCompanyNameChange('Edited company')
        expect(render(useSystemSettingsLogic).state.companyName).toBe(
            'Edited company',
        )
    })
})
