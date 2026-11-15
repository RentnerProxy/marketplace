import { describe, expect, it, vi } from 'bun:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import CustomBackgroundPreview from '@/features/UserSettings/Components/AppearanceSection/Components/CustomBackgroundPreview.tsx'
import type { CustomBackgroundPreviewProps } from '@/features/UserSettings/Components/AppearanceSection/Types/custom-background-component-props.types.ts'

vi.mock('@/language/useTranslationStore.ts', () => ({
    default: () => ({ t: (key: string) => key }),
}))

const props: CustomBackgroundPreviewProps = {
    containerRef: { current: null },
    handler: {
        handleBackgroundCropChange: vi.fn(),
        handleBackgroundCropComplete: vi.fn(),
        handleBackgroundZoomChange: vi.fn(),
    },
    state: {
        backgroundCrop: { x: 0, y: 0 },
        backgroundImageSrc: null,
        backgroundZoom: 1,
        cropSize: { width: 408, height: 300 },
        customBackgroundDarknessValue: 55,
        previewBackgroundSrc: '/api/user/background?v=saved',
        previewLayout: {
            aspectRatio: 16 / 9,
            isSidebarCollapsed: false,
            sidebarWidth: '24%',
            topbarHeight: '7%',
        },
    },
}

describe('Hintergrund-Vorschau vor und nach dem Speichern', function () {
    it.each([null, '/selected-image.png'])(
        'zeigt die Topbar und die Benachrichtigungsglocke bei Auswahl %s',
        function (backgroundImageSrc) {
            const html = renderToStaticMarkup(
                createElement(CustomBackgroundPreview, {
                    ...props,
                    state: { ...props.state, backgroundImageSrc },
                }),
            )

            expect(html).toContain('inset-x-0 top-0 z-20')
            expect(html).toContain('height:7%')
            expect(html.match(/height:7%/g)).toHaveLength(2)
            expect(html.match(/min-h-10/g)).toHaveLength(2)
            expect(html).toContain('lucide-bell')
            expect(html).toContain('opacity:0.55')
            expect(html).toContain('userSettings.background.preview')
        },
    )

    it('zentriert das gespeicherte Bild wie die tatsächliche Shell', function () {
        const html = renderToStaticMarkup(
            createElement(CustomBackgroundPreview, props),
        )

        expect(html).toContain('bg-cover bg-center bg-no-repeat')
        expect(html).not.toContain('left center')
    })

    it('füllt den gewählten Ausschnitt auch vor dem Speichern vollständig', function () {
        const html = renderToStaticMarkup(
            createElement(CustomBackgroundPreview, {
                ...props,
                state: {
                    ...props.state,
                    backgroundImageSrc: '/selected-image.png',
                },
            }),
        )

        expect(html).not.toMatch(/\breactEasyCrop_Contain\b/)
        expect(html).toMatch(/reactEasyCrop_Cover_(Horizontal|Vertical)/)
    })
})
