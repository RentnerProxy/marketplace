import { beforeEach, describe, expect, it, mock } from 'bun:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import CustomBackgroundSection from '@/features/UserSettings/Components/AppearanceSection/Components/CustomBackgroundSection.tsx'
import CustomBackgroundControls from '@/features/UserSettings/Components/AppearanceSection/Components/CustomBackgroundControls.tsx'
import CustomBackgroundPreview from '@/features/UserSettings/Components/AppearanceSection/Components/CustomBackgroundPreview.tsx'
import type useCustomBackgroundLogic from '@/features/UserSettings/Components/AppearanceSection/Hooks/useCustomBackgroundLogic.ts'
import {
    elements,
    findElement,
    invoke,
} from '@/tests/shared/RouteErrorComponent/renderHelpers.ts'

let logic: ReturnType<typeof useCustomBackgroundLogic>
mock.module('@/language/useTranslationStore.ts', () => ({
    default: () => ({
        t: (key: string, values?: Record<string, unknown>) =>
            key + (values ? JSON.stringify(values) : ''),
    }),
}))
mock.module(
    '@/features/UserSettings/Components/AppearanceSection/Hooks/useCustomBackgroundLogic.ts',
    () => ({ default: () => logic }),
)
mock.module('react-easy-crop', () => ({
    default: ({ image }: { image: string }) =>
        createElement('img', { src: image, alt: 'Background crop' }),
}))

beforeEach(() => {
    logic = {
        refs: { containerRef: { current: null } },
        handler: {
            handleBackgroundCropChange: mock(),
            handleBackgroundCropComplete: mock(),
            handleBackgroundDarknessChange: mock(),
            handleBackgroundZoomChange: mock(),
            handleDeleteBackgroundImage: mock(),
            handleResetSelectedBackgroundImage: mock(),
            handleSaveBackgroundAppearance: mock(),
            handleSaveBackgroundImage: mock(),
            handleSelectBackgroundImage: mock(),
        },
        state: {
            backgroundCrop: { x: 0, y: 0 },
            backgroundCroppedAreaPixels: null,
            backgroundImageSrc: null,
            backgroundZoom: 1,
            cropSize: { width: 320, height: 180 },
            customBackgroundDarknessValue: 40,
            customBackgroundSrc: '',
            hasCustomBackground: false,
            isDeletingBackgroundImage: false,
            isSavingBackgroundAppearance: false,
            isSavingBackgroundImage: false,
            previewBackgroundSrc: '',
            previewLayout: {
                aspectRatio: 16 / 9,
                isSidebarCollapsed: false,
                sidebarWidth: '20%',
                topbarHeight: '10%',
            },
        },
    }
})
const preview = () =>
    CustomBackgroundPreview({
        state: logic.state,
        handler: logic.handler,
        containerRef: logic.refs.containerRef,
    })

describe('Custom background', () => {
    it('renders the empty preview and disables save until a crop is available', () => {
        const html = renderToStaticMarkup(CustomBackgroundSection())
        expect(html).toContain('role="group"')
        expect(html).toContain('aria-label="userSettings.background.preview"')
        expect(html).toContain('userSettings.background.empty')
        const controls = CustomBackgroundControls(logic)
        expect(
            findElement(
                controls,
                (element) =>
                    element.props.onClick ===
                    logic.handler.handleSaveBackgroundImage,
            ).props.disabled,
        ).toBe(true)
        expect(
            elements(controls).filter(
                (element) => element.props.type === 'range',
            ),
        ).toHaveLength(0)
    })

    it('forwards chosen files and empty selection through the upload input', () => {
        const input = findElement(
            CustomBackgroundSection(),
            (element) => element.props.type === 'file',
        )
        const file = new File(['image'], 'background.webp', {
            type: 'image/webp',
        })
        invoke(input, 'onChange', { target: { files: [file] } })
        invoke(input, 'onChange', { target: { files: [] } })
        expect(
            logic.handler.handleSelectBackgroundImage,
        ).toHaveBeenNthCalledWith(1, file)
        expect(
            logic.handler.handleSelectBackgroundImage,
        ).toHaveBeenNthCalledWith(2, null)
    })

    it('renders a selected crop and numeric zoom/darkness controls with all actions', () => {
        Object.assign(logic.state, {
            backgroundImageSrc: '/selected.webp',
            backgroundCroppedAreaPixels: {
                x: 0,
                y: 0,
                width: 320,
                height: 180,
            },
            customBackgroundSrc: '/existing.webp',
            hasCustomBackground: true,
        })
        const html = renderToStaticMarkup(preview())
        expect(html).toContain('Background crop')
        expect(html).toContain('opacity:0.4')
        const controls = CustomBackgroundControls(logic)
        const zoom = findElement(
            controls,
            (element) =>
                element.props.type === 'range' && element.props.max === 3,
        )
        const darkness = findElement(
            controls,
            (element) =>
                element.props.type === 'range' && element.props.max === 95,
        )
        invoke(zoom, 'onChange', { target: { value: '2.2' } })
        invoke(darkness, 'onChange', { target: { value: '55' } })
        expect(logic.handler.handleBackgroundZoomChange).toHaveBeenCalledWith(
            2.2,
        )
        expect(
            logic.handler.handleBackgroundDarknessChange,
        ).toHaveBeenCalledWith(55)
        for (const callback of [
            logic.handler.handleSaveBackgroundImage,
            logic.handler.handleSaveBackgroundAppearance,
            logic.handler.handleResetSelectedBackgroundImage,
            logic.handler.handleDeleteBackgroundImage,
        ]) {
            const button = findElement(
                controls,
                (element) => element.props.onClick === callback,
            )
            expect(button.props.disabled).not.toBe(true)
            invoke(button, 'onClick')
            expect(callback).toHaveBeenCalledTimes(1)
        }
        const cropper = findElement(
            preview(),
            (element) => element.props.image === '/selected.webp',
        )
        expect(cropper.props.cropSize).toEqual({ width: 320, height: 180 })
        invoke(cropper, 'onCropChange', { x: 1, y: 2 })
        expect(logic.handler.handleBackgroundCropChange).toHaveBeenCalledWith({
            x: 1,
            y: 2,
        })
    })

    it('renders a stored background with a collapsed sidebar and pending operation labels', () => {
        Object.assign(logic.state, {
            previewBackgroundSrc: '/existing.webp',
            customBackgroundSrc: '/existing.webp',
            hasCustomBackground: true,
            isDeletingBackgroundImage: true,
            isSavingBackgroundAppearance: true,
            isSavingBackgroundImage: true,
        })
        logic.state.previewLayout.isSidebarCollapsed = true
        const html = renderToStaticMarkup(preview())
        expect(html).toContain('/existing.webp')
        expect(html).not.toContain('userSettings.background.empty')
        expect(html).not.toContain('Background crop')
        const controls = CustomBackgroundControls(logic)
        const rendered = renderToStaticMarkup(controls)
        expect(rendered).toContain('userSettings.background.removing')
        expect(rendered).toContain('common.saving')
        for (const callback of [
            logic.handler.handleSaveBackgroundImage,
            logic.handler.handleSaveBackgroundAppearance,
            logic.handler.handleDeleteBackgroundImage,
        ])
            expect(
                findElement(
                    controls,
                    (element) => element.props.onClick === callback,
                ).props.disabled,
            ).toBe(true)
    })
})
