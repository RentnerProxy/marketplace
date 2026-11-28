import { describe, expect, it, mock } from 'bun:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import CompanyLogoSection from '@/features/Admin/SystemSettings/Components/CompanyLogoSection.tsx'
import MaintenanceSection from '@/features/Admin/SystemSettings/Components/MaintenanceSection.tsx'
import CompanyNameSection from '@/features/Admin/SystemSettings/Components/CompanyNameSection.tsx'
import PublicRegistrationSection from '@/features/Admin/SystemSettings/Components/PublicRegistrationSection.tsx'
import type {
    CompanyLogoSectionProps,
    MaintenanceSectionProps,
} from '@/features/Admin/SystemSettings/Types/system-settings-component-props.types.ts'
import {
    elements,
    findElement,
    invoke,
} from '@/tests/shared/RouteErrorComponent/renderHelpers.ts'

mock.module('@/language/useTranslationStore.ts', () => ({
    default: () => ({
        language: 'de',
        t: (key: string, values?: Record<string, unknown>) =>
            key + (values ? JSON.stringify(values) : ''),
    }),
}))
mock.module('react-easy-crop', () => ({
    default: ({ image }: { image: string }) =>
        createElement('img', { src: image, alt: 'Selected crop' }),
}))

function logoProps(): CompanyLogoSectionProps {
    return {
        state: {
            logoPreviewSrc: '/logo.png',
            selectedLogoDataUrl: null,
            crop: { x: 0, y: 0 },
            zoom: 1,
            isSavingLogo: false,
        },
        handler: {
            handleSelectLogo: mock(),
            handleCropChange: mock(),
            handleZoomChange: mock(),
            handleCropComplete: mock(),
            handleSaveLogo: mock(),
            handleResetSelectedLogo: mock(),
        },
    }
}
function maintenanceProps(): MaintenanceSectionProps {
    return {
        state: {
            isMaintenanceModeEnabled: false,
            isMaintenanceModeActive: false,
            maintenanceMinDateTime: new Date('2026-01-01T08:00:00Z'),
            maintenanceStartsAt: '2026-01-02T08:00:00Z',
            pendingMaintenanceExtensionRequest: null,
            maintenanceExtensionMinutes: 15,
            maintenanceExtensionMinutesError: null,
            isSavingMaintenanceMode: false,
            isResolvingMaintenanceExtensionRequest: false,
        },
        handler: {
            handleMaintenanceStartsAtChange: mock(),
            handleMaintenanceExtensionMinutesChange: mock(),
            handleEnableMaintenanceMode: mock(),
            handleDisableMaintenanceMode: mock(),
            handleApproveMaintenanceExtensionRequest: mock(),
            handleRejectMaintenanceExtensionRequest: mock(),
        },
    }
}

describe('CompanyLogoSection', () => {
    it('renders current logo previews and disables save without a selection', () => {
        const tree = CompanyLogoSection(logoProps())
        const html = renderToStaticMarkup(tree)
        expect(html).toContain('src="/logo.png"')
        expect(html).toContain('alt="admin.systemSettings.logoAlt"')
        expect(html).toContain('alt="admin.systemSettings.logoPreview"')
        expect(html).not.toContain('type="range"')
        expect(
            findElement(tree, (element) => element.type === 'button').props
                .disabled,
        ).toBe(true)
    })

    it('renders selected crop, bounded zoom and pending-save state', () => {
        const props = logoProps()
        props.state.selectedLogoDataUrl = 'data:image/png;base64,test'
        props.state.zoom = 2
        props.state.isSavingLogo = true
        const tree = CompanyLogoSection(props)
        const html = renderToStaticMarkup(tree)
        expect(html).toContain('Selected crop')
        expect(html).toContain('common.saving')
        const zoom = findElement(
            tree,
            (element) => element.props.type === 'range',
        )
        expect(zoom.props).toMatchObject({
            min: 1,
            max: 3,
            step: 0.1,
            value: 2,
        })
        invoke(zoom, 'onChange', { target: { value: '2.5' } })
        expect(props.handler.handleZoomChange).toHaveBeenCalledWith(2.5)
        invoke(
            findElement(
                tree,
                (element) =>
                    element.props.onClick ===
                    props.handler.handleResetSelectedLogo,
            ),
            'onClick',
        )
        invoke(
            findElement(
                tree,
                (element) =>
                    element.props.onClick === props.handler.handleSaveLogo,
            ),
            'onClick',
        )
        expect(props.handler.handleResetSelectedLogo).toHaveBeenCalledTimes(1)
        expect(props.handler.handleSaveLogo).toHaveBeenCalledTimes(1)
    })

    it('forwards the selected file or an empty selection as null', () => {
        const props = logoProps()
        const input = findElement(
            CompanyLogoSection(props),
            (element) => element.props.type === 'file',
        )
        const file = new File(['png'], 'logo.png', { type: 'image/png' })
        invoke(input, 'onChange', { target: { files: [file] } })
        invoke(input, 'onChange', { target: { files: null } })
        expect(props.handler.handleSelectLogo).toHaveBeenNthCalledWith(1, file)
        expect(props.handler.handleSelectLogo).toHaveBeenNthCalledWith(2, null)
        expect(input.props.accept).toContain('image/png')
    })

    it('applies the logo and favicon fallbacks on failed previews', () => {
        const images = elements(CompanyLogoSection(logoProps())).filter(
            (element) => element.type === 'img',
        )
        for (const image of images) {
            const target = { src: '/broken.png', dataset: {} }
            invoke(image, 'onError', { currentTarget: target })
            expect(target.src).not.toBe('/broken.png')
        }
    })
})

it('renders the saved registration state as a labelled switch and forwards changes', () => {
    const onChange = mock()
    const tree = PublicRegistrationSection({
        enabled: false,
        disabled: false,
        onChange,
    })
    const control = findElement(
        tree,
        (element) => element.props.role === 'switch',
    )
    expect(control.props).toMatchObject({
        type: 'checkbox',
        checked: false,
        'aria-labelledby': 'public-registration-label',
        'aria-describedby': 'public-registration-description',
    })
    invoke(control, 'onChange', { currentTarget: { checked: true } })
    expect(onChange).toHaveBeenCalledWith(true)
    const saving = PublicRegistrationSection({
        enabled: true,
        disabled: true,
        onChange,
    })
    expect(
        findElement(saving, (element) => element.props.role === 'switch').props,
    ).toMatchObject({ checked: true, disabled: true })
})

describe('CompanyNameSection', () => {
    it('renders the required bounded company name and forwards update/save with pending feedback', () => {
        const handler = {
            handleCompanyNameChange: mock(),
            handleSaveCompanyName: mock(),
        }
        for (const isSavingCompanyName of [false, true]) {
            const tree = CompanyNameSection({
                state: { companyName: 'Example GmbH', isSavingCompanyName },
                handler,
            })
            const html = renderToStaticMarkup(tree)
            expect(html).toContain('Example GmbH')
            const input = findElement(
                tree,
                (element) =>
                    element.props.onValueChange ===
                    handler.handleCompanyNameChange,
            )
            expect(input.props).toMatchObject({
                required: true,
                maxLength: 100,
            })
            const save = findElement(
                tree,
                (element) => element.type === 'button',
            )
            expect(save.props.disabled).toBe(isSavingCompanyName)
            if (!isSavingCompanyName) {
                invoke(input, 'onValueChange', 'New GmbH')
                invoke(save, 'onClick')
            } else expect(html).toContain('common.saving')
        }
        expect(handler.handleCompanyNameChange).toHaveBeenCalledWith('New GmbH')
        expect(handler.handleSaveCompanyName).toHaveBeenCalledTimes(1)
    })
})

describe('MaintenanceSection', () => {
    it('offers scheduling while inactive and forwards calendar and plan actions', () => {
        const props = maintenanceProps()
        const tree = MaintenanceSection(props)
        const html = renderToStaticMarkup(tree)
        expect(html).toContain('common.inactive')
        const calendar = findElement(
            tree,
            (element) => element.props.valueFormat === 'iso-datetime',
        )
        expect(calendar.props.enableTime).toBe(true)
        invoke(calendar, 'onChange', '2026-01-03T09:00:00Z')
        invoke(
            findElement(
                tree,
                (element) =>
                    element.props.onClick ===
                    props.handler.handleEnableMaintenanceMode,
            ),
            'onClick',
        )
        expect(
            props.handler.handleMaintenanceStartsAtChange,
        ).toHaveBeenCalledWith('2026-01-03T09:00:00Z')
        expect(props.handler.handleEnableMaintenanceMode).toHaveBeenCalledTimes(
            1,
        )
        expect(
            findElement(
                tree,
                (element) =>
                    element.props.onClick ===
                    props.handler.handleDisableMaintenanceMode,
            ).props.disabled,
        ).toBe(true)
    })

    it.each([false, true])(
        'shows enabled maintenance active=%s and blocks duplicate scheduling',
        (isMaintenanceModeActive) => {
            const props = maintenanceProps()
            Object.assign(props.state, {
                isMaintenanceModeEnabled: true,
                isMaintenanceModeActive,
            })
            const tree = MaintenanceSection(props)
            const html = renderToStaticMarkup(tree)
            expect(html).toContain(
                isMaintenanceModeActive ? 'common.active' : 'common.planned',
            )
            expect(
                elements(tree).some(
                    (element) => element.props.valueFormat === 'iso-datetime',
                ),
            ).toBe(false)
            expect(
                findElement(
                    tree,
                    (element) =>
                        element.props.onClick ===
                        props.handler.handleEnableMaintenanceMode,
                ).props.disabled,
            ).toBe(true)
            expect(
                findElement(
                    tree,
                    (element) =>
                        element.props.onClick ===
                        props.handler.handleDisableMaintenanceMode,
                ).props.disabled,
            ).toBe(false)
        },
    )

    it('shows extension requester and reason, validates minutes and wires resolution actions', () => {
        const props = maintenanceProps()
        props.state.pendingMaintenanceExtensionRequest = {
            id: 'req-1',
            reason: 'Finish customer export',
            requestedAt: '2026-01-01',
            user: { id: 'user-1', username: 'Support' },
        }
        const tree = MaintenanceSection(props)
        const html = renderToStaticMarkup(tree)
        expect(html).toContain('Finish customer export')
        expect(html).toContain('Support')
        const minutes = findElement(
            tree,
            (element) =>
                element.props.onValueChange ===
                props.handler.handleMaintenanceExtensionMinutesChange,
        )
        expect(minutes.props).toMatchObject({ min: 1, max: 120, step: 1 })
        invoke(minutes, 'onValueChange', 30)
        invoke(
            findElement(
                tree,
                (element) =>
                    element.props.onClick ===
                    props.handler.handleApproveMaintenanceExtensionRequest,
            ),
            'onClick',
        )
        invoke(
            findElement(
                tree,
                (element) =>
                    element.props.onClick ===
                    props.handler.handleRejectMaintenanceExtensionRequest,
            ),
            'onClick',
        )
        expect(
            props.handler.handleMaintenanceExtensionMinutesChange,
        ).toHaveBeenCalledWith(30)
        expect(
            props.handler.handleApproveMaintenanceExtensionRequest,
        ).toHaveBeenCalledTimes(1)
        expect(
            props.handler.handleRejectMaintenanceExtensionRequest,
        ).toHaveBeenCalledTimes(1)
        props.state.maintenanceExtensionMinutesError = 'Choose 1–120 minutes'
        const invalid = MaintenanceSection(props)
        expect(
            findElement(
                invalid,
                (element) =>
                    element.props.onClick ===
                    props.handler.handleApproveMaintenanceExtensionRequest,
            ).props.disabled,
        ).toBe(true)
        props.state.isResolvingMaintenanceExtensionRequest = true
        props.state.isSavingMaintenanceMode = true
        const pending = MaintenanceSection(props)
        for (const button of elements(pending).filter(
            (element) => element.type === 'button',
        ))
            expect(button.props.disabled).toBe(true)
    })
})
