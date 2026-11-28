import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import {
    restoreTestGlobals,
    stubTestGlobal,
} from '@/tests/shared/bunTestStubs.ts'
import { createElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type useAppDetailPageLogic from '@/features/AppStore/Hooks/useAppDetailPageLogic.ts'
import type useEditableStoreAppsLogic from '@/features/AppStore/Hooks/useEditableStoreAppsLogic.ts'
import type useScreenshotGalleryLogic from '@/features/AppStore/Hooks/useScreenshotGalleryLogic.ts'
import type useStoreDescriptionLogic from '@/features/AppStore/Hooks/useStoreDescriptionLogic.ts'
import type useStoreEditorPageLogic from '@/features/AppStore/Hooks/useStoreEditorPageLogic.ts'
import type useStoreLogoLogic from '@/features/AppStore/Hooks/useStoreLogoLogic.ts'
import type useStoreScreenshotsLogic from '@/features/AppStore/Hooks/useStoreScreenshotsLogic.ts'
import type {
    AppDetail,
    StoreEntryEditor,
} from '@/features/AppStore/Types/app-store.types.ts'

let editorPage: ReturnType<typeof useStoreEditorPageLogic>
let logo: ReturnType<typeof useStoreLogoLogic>
let shots: ReturnType<typeof useStoreScreenshotsLogic>
let description: ReturnType<typeof useStoreDescriptionLogic>
let gallery: ReturnType<typeof useScreenshotGalleryLogic>
let detailPage: ReturnType<typeof useAppDetailPageLogic>
let editable: ReturnType<typeof useEditableStoreAppsLogic>

mock.module('@/language/useTranslationStore.ts', () => ({
    default: () => ({
        language: 'de',
        t: (key: string, values?: Record<string, unknown>) =>
            key + (values ? JSON.stringify(values) : ''),
    }),
}))
mock.module('@tanstack/react-router', () => ({
    Link: ({
        to,
        params,
        children,
        className,
    }: {
        to: string
        params?: Record<string, string>
        children: ReactNode
        className?: string
    }) =>
        createElement(
            'a',
            {
                href: to.replace(
                    /\$(\w+)/gu,
                    (_match, key: string) => params?.[key] ?? '',
                ),
                className,
            },
            children,
        ),
}))
mock.module('react-dom', () => ({ createPortal: (node: unknown) => node }))
mock.module('@rentnerkev/tooltips', () => ({
    CustomTooltip: ({
        children,
        content,
    }: {
        children: ReactNode
        content: ReactNode
    }) => createElement('span', { 'data-tooltip': content }, children),
}))
mock.module('react-easy-crop', () => ({
    default: ({ image }: { image: string }) =>
        createElement('img', { src: image, alt: 'Crop' }),
}))
mock.module('@/shared/SafeDeleteModal/index.tsx', () => ({
    default: ({ isOpen, question }: { isOpen: boolean; question: string }) =>
        isOpen ? createElement('dialog', { open: true }, question) : null,
}))
mock.module('@/features/Social/Hooks/useStarButtonLogic.ts', () => ({
    default: () => ({
        state: { isPending: false },
        handler: { handleToggleStar: mock() },
    }),
}))
mock.module('@/features/AppStore/Hooks/useStoreEditorPageLogic.ts', () => ({
    default: () => editorPage,
}))
mock.module('@/features/AppStore/Hooks/useStoreLogoLogic.ts', () => ({
    default: () => logo,
}))
mock.module('@/features/AppStore/Hooks/useStoreScreenshotsLogic.ts', () => ({
    default: () => shots,
}))
mock.module('@/features/AppStore/Hooks/useStoreDescriptionLogic.ts', () => ({
    default: () => description,
}))
mock.module('@/features/AppStore/Hooks/useScreenshotGalleryLogic.ts', () => ({
    default: () => gallery,
}))
mock.module('@/features/AppStore/Hooks/useAppDetailPageLogic.ts', () => ({
    default: () => detailPage,
}))
mock.module('@/features/AppStore/Hooks/useEditableStoreAppsLogic.ts', () => ({
    default: () => editable,
}))

const { default: AppLogo } =
    await import('@/features/AppStore/Components/AppLogo.tsx')
const { default: EditableStoreApps } =
    await import('@/features/AppStore/Components/EditableStoreApps.tsx')
const { default: StoreDescriptionEditor } =
    await import('@/features/AppStore/Components/StoreDescriptionEditor.tsx')
const { default: StoreLogoEditor } =
    await import('@/features/AppStore/Components/StoreLogoEditor.tsx')
const { default: StoreScreenshotsEditor } =
    await import('@/features/AppStore/Components/StoreScreenshotsEditor.tsx')
const { default: ScreenshotGallery } =
    await import('@/features/AppStore/Detail/Components/ScreenshotGallery.tsx')
const { default: AppDetailNotFound } =
    await import('@/features/AppStore/Detail/Components/AppDetailNotFound.tsx')
const { default: AppDetailPage } =
    await import('@/features/AppStore/Detail/index.tsx')
const { default: StoreEditorPage } =
    await import('@/features/AppStore/Editor/index.tsx')

const appId = 'rentner.weather-widget'
const shotIds = [
    '019f72d1-dc60-7040-bdac-9e201573f0a1',
    '019f72d1-dc60-7040-bdac-9e201573f0a2',
    '019f72d1-dc60-7040-bdac-9e201573f0a3',
]
const screenshots = shotIds.map((id) => ({
    id,
    src: `/images/apps/${appId}/${id}.webp`,
}))
const entry: StoreEntryEditor = {
    appId,
    name: 'Wetter',
    status: 'published',
    isPublished: true,
    description: 'Lange Beschreibung',
    logoSrc: `/images/apps/${appId}/logo.webp`,
    screenshots,
}
const detail: AppDetail = {
    appId,
    name: 'Wetter',
    summary: 'Zeigt das Wetter.',
    license: 'MIT',
    version: '1.2.0',
    publishedAt: '2026-10-02T00:00:00.000Z',
    description: 'Lange Beschreibung\nin zwei Zeilen',
    logoSrc: null,
    screenshots: [],
    starCount: 3,
    isStarred: false,
    canEdit: false,
    publisher: { id: 'publisher-1', username: 'kevin', profileImageVersion: 4 },
}

function render(element: ReturnType<typeof createElement>) {
    return renderToStaticMarkup(element)
}

function count(html: string, needle: string) {
    return html.split(needle).length - 1
}

beforeEach(() => {
    editorPage = { state: { entry, isLoading: false } }
    logo = {
        state: {
            imageSrc: null,
            crop: { x: 0, y: 0 },
            zoom: 1,
            isSavingLogo: false,
            isRemoveDialogOpen: false,
            isRemovingLogo: false,
        },
        handler: {
            handleSelectImage: mock(),
            handleCropComplete: mock(),
            handleCropChange: mock(),
            handleZoomChange: mock(),
            handleCancelLogo: mock(),
            handleSaveLogo: mock(),
            handleOpenRemoveLogo: mock(),
            handleCloseRemoveLogo: mock(),
            handleConfirmRemoveLogo: mock(),
        },
    }
    shots = {
        state: {
            imageSrc: null,
            crop: { x: 0, y: 0 },
            zoom: 1,
            canAdd: true,
            isSavingScreenshot: false,
            isReordering: false,
            removeId: null,
            isRemovingScreenshot: false,
        },
        handler: {
            handleSelectImage: mock(),
            handleCropComplete: mock(),
            handleCropChange: mock(),
            handleZoomChange: mock(),
            handleCancelScreenshot: mock(),
            handleSaveScreenshot: mock(),
            handleMove: mock(),
            handleOpenRemove: mock(),
            handleCloseRemove: mock(),
            handleConfirmRemove: mock(),
        },
    }
    description = {
        state: { value: 'Text', hasChanged: false, isSaving: false },
        handler: {
            handleChange: mock(),
            handleReset: mock(),
            handleSave: mock(),
        },
    }
    gallery = {
        state: { activeIndex: 0, isLightboxOpen: false },
        handler: {
            handleSelect: mock(),
            handlePrevious: mock(),
            handleNext: mock(),
            handleOpenLightbox: mock(),
            handleCloseLightbox: mock(),
        },
    }
    detailPage = { state: { app: detail, isSignedIn: true } }
    editable = { state: { apps: [], isLoading: false } }
})

afterEach(restoreTestGlobals)

describe('app logo', () => {
    it('renders the logo image when a source exists', () => {
        const html = render(
            createElement(AppLogo, {
                logoSrc: '/logo.webp',
                name: 'Wetter',
                size: 'md',
            }),
        )
        expect(html).toContain('<img src="/logo.webp" alt="Wetter"')
        expect(html).not.toContain('aria-hidden')
    })

    it('falls back to a decorative icon without a logo', () => {
        const html = render(
            createElement(AppLogo, {
                logoSrc: null,
                name: 'Wetter',
                size: 'sm',
            }),
        )
        expect(html).not.toContain('<img')
        expect(html).toContain('aria-hidden="true"')
        expect(html).toContain('<svg')
    })
})

describe('editable store apps', () => {
    it('explains the empty list and renders nothing while loading', () => {
        expect(render(createElement(EditableStoreApps))).toContain(
            'appStore.overviewEmpty',
        )
        editable = {
            state: {
                apps: [
                    {
                        appId,
                        name: 'Wetter',
                        status: 'submitted',
                        logoSrc: null,
                    },
                ],
                isLoading: true,
            },
        }
        expect(render(createElement(EditableStoreApps))).toBe('')
    })

    it('lists own apps with status and an edit link', () => {
        editable = {
            state: {
                apps: [
                    {
                        appId,
                        name: 'Wetter',
                        status: 'submitted',
                        logoSrc: null,
                    },
                    {
                        appId: 'rentner.other',
                        name: 'Anderes',
                        status: 'published',
                        logoSrc: '/other.webp',
                    },
                ],
                isLoading: false,
            },
        }
        const html = render(createElement(EditableStoreApps))
        expect(html).not.toContain('appStore.overviewEmpty')
        expect(html).toContain('Wetter')
        expect(html).toContain('submissions.status.submitted')
        expect(html).toContain('submissions.status.published')
        expect(html).toContain(`href="/user/app-submissions/${appId}"`)
        expect(html).toContain('href="/user/app-submissions/rentner.other"')
        expect(html).toContain('src="/other.webp"')
    })
})

describe('store editor page', () => {
    it('shows a loading state', () => {
        editorPage = { state: { entry: null, isLoading: true } }
        const html = render(createElement(StoreEditorPage, { appId }))
        expect(html).toContain('appStore.loading')
        expect(html).toContain('animate-spin')
    })

    it('explains missing access and links back to the submissions', () => {
        editorPage = { state: { entry: null, isLoading: false } }
        const html = render(createElement(StoreEditorPage, { appId }))
        expect(html).toContain('appStore.notAllowedTitle')
        expect(html).toContain('href="/user/app-submissions"')
        expect(html).not.toContain('appStore.logo.title')
    })

    it('renders all editors with status and a public link when published', () => {
        const html = render(createElement(StoreEditorPage, { appId }))
        expect(html).toContain('Wetter')
        expect(html).toContain(appId)
        expect(html).toContain('submissions.status.published')
        expect(html).toContain(`href="/apps/${appId}"`)
        expect(html).toContain('appStore.viewPublic')
        expect(html).not.toContain('appStore.notPublishedHint')
        expect(html).toContain('appStore.logo.title')
        expect(html).toContain('appStore.screenshots.title')
        expect(html).toContain('appStore.description.title')
    })

    it('hides the public link and hints at the missing publication', () => {
        editorPage = {
            state: {
                entry: {
                    ...entry,
                    status: 'awaitingReview',
                    isPublished: false,
                },
                isLoading: false,
            },
        }
        const html = render(createElement(StoreEditorPage, { appId }))
        expect(html).toContain('submissions.status.awaitingReview')
        expect(html).toContain('appStore.notPublishedHint')
        expect(html).not.toContain('appStore.viewPublic')
        expect(html).not.toContain(`href="/apps/${appId}"`)
    })
})

describe('store logo editor', () => {
    it('offers an upload without a logo', () => {
        const html = render(
            createElement(StoreLogoEditor, { appId, logoSrc: null, name: 'W' }),
        )
        expect(html).toContain('appStore.logo.upload')
        expect(html).not.toContain('appStore.logo.change')
        expect(html).not.toContain('appStore.logo.remove')
        expect(html).toContain('accept="image/jpeg,image/png,image/webp"')
    })

    it('offers change and remove with a logo', () => {
        const html = render(
            createElement(StoreLogoEditor, {
                appId,
                logoSrc: '/logo.webp',
                name: 'Wetter',
            }),
        )
        expect(html).toContain('appStore.logo.change')
        expect(html).toContain('appStore.logo.remove')
        expect(html).toContain('src="/logo.webp"')
    })

    it('shows the crop dialog and the removal confirmation on demand', () => {
        stubTestGlobal('document', { body: {} })
        logo.state.imageSrc = 'data:image/png;base64,AAAA'
        logo.state.isRemoveDialogOpen = true
        const html = render(
            createElement(StoreLogoEditor, {
                appId,
                logoSrc: '/logo.webp',
                name: 'Wetter',
            }),
        )
        expect(html).toContain('appStore.logo.cropTitle')
        expect(html).toContain('appStore.cropHint')
        expect(html).toContain('appStore.logo.removeQuestion')
    })
})

describe('store screenshots editor', () => {
    it('shows the count, the tiles and the add tile', () => {
        const html = render(
            createElement(StoreScreenshotsEditor, { appId, screenshots }),
        )
        expect(html).toMatch(/3(<!-- -->)?\/(<!-- -->)?8/u)
        expect(count(html, '<img')).toBe(3)
        expect(html).toContain('appStore.screenshots.add')
        expect(html).toContain('appStore.screenshots.alt{&quot;number&quot;:2}')
    })

    it('hides the add tile at the screenshot limit', () => {
        shots.state.canAdd = false
        const html = render(
            createElement(StoreScreenshotsEditor, { appId, screenshots }),
        )
        expect(html).not.toContain('appStore.screenshots.add')
    })

    it('disables the move buttons at both ends only', () => {
        const html = render(
            createElement(StoreScreenshotsEditor, { appId, screenshots }),
        )
        expect(count(html, 'disabled=""')).toBe(2)

        shots.state.isReordering = true
        expect(
            count(
                render(
                    createElement(StoreScreenshotsEditor, {
                        appId,
                        screenshots,
                    }),
                ),
                'disabled=""',
            ),
        ).toBe(6)
    })

    it('shows the crop dialog and the removal confirmation on demand', () => {
        stubTestGlobal('document', { body: {} })
        shots.state.imageSrc = 'data:image/png;base64,AAAA'
        shots.state.removeId = shotIds[0] ?? null
        const html = render(
            createElement(StoreScreenshotsEditor, { appId, screenshots }),
        )
        expect(html).toContain('appStore.screenshots.cropTitle')
        expect(html).toContain('appStore.screenshots.removeQuestion')
    })

    it('renders only the add tile without screenshots', () => {
        const html = render(
            createElement(StoreScreenshotsEditor, { appId, screenshots: [] }),
        )
        expect(html).toMatch(/0(<!-- -->)?\/(<!-- -->)?8/u)
        expect(html).toContain('appStore.screenshots.add')
        expect(html).not.toContain('disabled=""')
    })
})

describe('store description editor', () => {
    it('shows the text, the counter and a disabled save without changes', () => {
        const html = render(
            createElement(StoreDescriptionEditor, {
                appId,
                description: 'Text',
            }),
        )
        expect(html).toContain('>Text</textarea>')
        expect(html).toContain('maxLength="5000"')
        expect(html).toMatch(/4(<!-- -->)?\/(<!-- -->)?5000/u)
        expect(count(html, 'disabled=""')).toBe(2)
    })

    it('enables saving and resetting after a change', () => {
        description.state = { value: 'Neu', hasChanged: true, isSaving: false }
        const html = render(
            createElement(StoreDescriptionEditor, {
                appId,
                description: 'Text',
            }),
        )
        expect(html).toMatch(/3(<!-- -->)?\/(<!-- -->)?5000/u)
        expect(html).not.toContain('disabled=""')
        expect(html).toContain('appStore.description.save')
    })

    it('shows a spinner and disables the buttons while saving', () => {
        description.state = { value: 'Neu', hasChanged: true, isSaving: true }
        const html = render(
            createElement(StoreDescriptionEditor, {
                appId,
                description: 'Text',
            }),
        )
        expect(html).toContain('animate-spin')
        expect(count(html, 'disabled=""')).toBe(2)
    })
})

describe('screenshot gallery', () => {
    it('renders nothing without screenshots', () => {
        expect(
            render(
                createElement(ScreenshotGallery, {
                    name: 'Wetter',
                    screenshots: [],
                }),
            ),
        ).toBe('')
    })

    it('shows a single screenshot without navigation and thumbnails', () => {
        const html = render(
            createElement(ScreenshotGallery, {
                name: 'Wetter',
                screenshots: screenshots.slice(0, 1),
            }),
        )
        expect(html).toContain(screenshots[0]?.src)
        expect(html).toContain('appStore.detail.openLightbox')
        expect(html).not.toContain('appStore.detail.previous')
        expect(html).not.toContain('appStore.detail.next')
        expect(html).not.toContain('aria-current')
        expect(count(html, '<img')).toBe(1)
    })

    it('shows navigation, counter and thumbnails for several screenshots', () => {
        gallery.state.activeIndex = 1
        const html = render(
            createElement(ScreenshotGallery, { name: 'Wetter', screenshots }),
        )
        expect(html).toContain('appStore.detail.previous')
        expect(html).toContain('appStore.detail.next')
        expect(html).toMatch(/2(<!-- -->)?\/(<!-- -->)?3/u)
        expect(count(html, 'aria-current')).toBe(3)
        expect(count(html, 'aria-current="true"')).toBe(1)
        expect(html).toContain(screenshots[1]?.src)
        expect(html).toContain(
            'appStore.detail.screenshotAlt{&quot;name&quot;:&quot;Wetter&quot;,&quot;number&quot;:2,&quot;total&quot;:3}',
        )
        expect(html).not.toContain('role="dialog"')
    })

    it('renders the lightbox with its own navigation when open', () => {
        stubTestGlobal('document', { body: {} })
        gallery.state.isLightboxOpen = true
        const html = render(
            createElement(ScreenshotGallery, { name: 'Wetter', screenshots }),
        )
        expect(html).toContain('role="dialog"')
        expect(html).toContain('appStore.detail.closeLightbox')
        expect(count(html, 'aria-label="appStore.detail.previous"')).toBe(2)

        const single = render(
            createElement(ScreenshotGallery, {
                name: 'Wetter',
                screenshots: screenshots.slice(0, 1),
            }),
        )
        expect(single).toContain('role="dialog"')
        expect(single).not.toContain('appStore.detail.previous')
    })
})

describe('app detail page', () => {
    it('renders nothing until the app is loaded', () => {
        detailPage = { state: { app: null, isSignedIn: false } }
        expect(render(createElement(AppDetailPage, { appId }))).toBe('')
    })

    it('shows the header facts and links to the publisher', () => {
        const html = render(createElement(AppDetailPage, { appId }))
        expect(html).toContain('Wetter')
        expect(html).toContain(appId)
        expect(html).toContain('href="/u/kevin"')
        expect(html).toContain(
            'appStore.detail.by{&quot;username&quot;:&quot;kevin&quot;}',
        )
        expect(html).toContain('profile.webp?v=4')
        expect(html).toContain(
            'social.appVersion{&quot;version&quot;:&quot;1.2.0&quot;}',
        )
        expect(html).toContain('MIT')
        expect(html).toContain('appStore.detail.published')
    })

    it('omits the publisher link when the publisher is not visible', () => {
        detailPage = {
            state: {
                app: { ...detail, publisher: null },
                isSignedIn: true,
            },
        }
        const html = render(createElement(AppDetailPage, { appId }))
        expect(html).not.toContain('appStore.detail.by')
        expect(html).not.toContain('href="/u/')
    })

    it('shows the edit link only for editors', () => {
        expect(render(createElement(AppDetailPage, { appId }))).not.toContain(
            'appStore.edit',
        )
        detailPage = {
            state: { app: { ...detail, canEdit: true }, isSignedIn: true },
        }
        const html = render(createElement(AppDetailPage, { appId }))
        expect(html).toContain(`href="/user/app-submissions/${appId}"`)
        expect(html).toContain('appStore.edit')
    })

    it('shows the description and falls back to the summary', () => {
        let html = render(createElement(AppDetailPage, { appId }))
        expect(html).toContain('Lange Beschreibung\nin zwei Zeilen')
        expect(count(html, 'Zeigt das Wetter.')).toBe(1)

        detailPage = {
            state: { app: { ...detail, description: null }, isSignedIn: true },
        }
        html = render(createElement(AppDetailPage, { appId }))
        expect(count(html, 'Zeigt das Wetter.')).toBe(2)
    })

    it('renders the gallery only with screenshots', () => {
        expect(render(createElement(AppDetailPage, { appId }))).not.toContain(
            'app-gallery-title',
        )
        detailPage = {
            state: { app: { ...detail, screenshots }, isSignedIn: true },
        }
        expect(render(createElement(AppDetailPage, { appId }))).toContain(
            'app-gallery-title',
        )
    })

    it('renders a friendly not-found page linking to the catalog', () => {
        const html = render(createElement(AppDetailNotFound))
        expect(html).toContain('appStore.detail.notFoundTitle')
        expect(html).toContain('href="/apps"')
    })
})
