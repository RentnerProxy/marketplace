import { beforeEach, expect, it, vi } from 'bun:test'
import { isValidElement } from 'react'
import type { ReactElement, ReactNode } from 'react'
import {
    query,
    render,
    reset,
} from '../UserManagement/user-management-hooks.test.helpers.ts'
import type {
    SystemSettingsHandler,
    SystemSettingsState,
} from '@/features/Admin/SystemSettings/Types/types.ts'

const saveName = vi.fn()
vi.mock('@/features/Admin/SystemSettings/middleware.ts', () => ({
    getAdminSystemSettingsHandler: vi.fn(),
    updateCompanyNameHandler: saveName,
    updateSystemLogoHandler: vi.fn(),
    updateMaintenanceModeHandler: vi.fn(),
    resolveMaintenanceExtensionRequestHandler: vi.fn(),
}))
vi.mock('@/shared/TransferOverlay/Hooks/useTransferOverlayTasks.ts', () => ({
    startTransferTask: vi.fn(),
}))
import SystemSettings from '@/features/Admin/SystemSettings/index.tsx'

function sections(node: ReactNode): Array<
    ReactElement<{
        state: Partial<SystemSettingsState>
        handler: Partial<SystemSettingsHandler>
    }>
> {
    if (Array.isArray(node)) return node.flatMap(sections)
    if (!isValidElement<Record<string, unknown>>(node)) return []
    const nested = sections(node.props.children as ReactNode)
    return 'state' in node.props && 'handler' in node.props
        ? [
              node as ReactElement<{
                  state: Partial<SystemSettingsState>
                  handler: Partial<SystemSettingsHandler>
              }>,
              ...nested,
          ]
        : nested
}

beforeEach(() => {
    reset()
    query.mockImplementation(() => ({
        data: {
            companyName: 'Company',
            logoSrc: '/logo.png',
            isMaintenanceModeEnabled: true,
            isMaintenanceModeActive: false,
        },
    }))
})

it('connects company-name, logo and maintenance settings to their visible sections', () => {
    const controls = sections(render(SystemSettings))
    const name = controls.find(
        (control) => 'companyName' in control.props.state,
    )
    const logo = controls.find(
        (control) => 'logoPreviewSrc' in control.props.state,
    )
    const maintenance = controls.find(
        (control) => 'isMaintenanceModeEnabled' in control.props.state,
    )
    expect(name?.props.state.companyName).toBe('Company')
    expect(logo?.props.state.logoPreviewSrc).toBe('/logo.png')
    expect(maintenance?.props.state.isMaintenanceModeEnabled).toBe(true)
    name?.props.handler.handleCompanyNameChange?.('Edited')
    const updated = sections(render(SystemSettings)).find(
        (control) => 'companyName' in control.props.state,
    )
    expect(updated?.props.state.companyName).toBe('Edited')
    logo?.props.handler.handleZoomChange?.(2)
    const zoomed = sections(render(SystemSettings)).find(
        (control) => 'logoPreviewSrc' in control.props.state,
    )
    expect(zoomed?.props.state.zoom).toBe(2)
    maintenance?.props.handler.handleMaintenanceExtensionMinutesChange?.(0)
    const invalid = sections(render(SystemSettings)).find(
        (control) => 'isMaintenanceModeEnabled' in control.props.state,
    )
    expect(invalid?.props.state.maintenanceExtensionMinutesError).toBe(
        'admin.systemSettings.extensionMinutesInvalid',
    )
})
