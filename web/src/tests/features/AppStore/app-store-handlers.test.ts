import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import {
    restoreTestGlobals,
    stubTestGlobal,
} from '@/tests/shared/bunTestStubs.ts'
import { isValidElement, type ReactElement, type ReactNode } from 'react'

const logo = {
    state: {
        imageSrc: null as string | null,
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
const screenshots = {
    state: {
        imageSrc: null as string | null,
        crop: { x: 0, y: 0 },
        zoom: 1,
        canAdd: true,
        isSavingScreenshot: false,
        isReordering: false,
        removeId: null as string | null,
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
const description = {
    state: { value: 'Hi', hasChanged: true, isSaving: false },
    handler: {
        handleChange: mock(),
        handleReset: mock(),
        handleSave: mock(),
    },
}

mock.module('react-dom', () => ({
    createPortal: (children: ReactNode) => children,
}))
mock.module('react-easy-crop', () => ({ default: () => null }))
mock.module('@/language/useTranslationStore.ts', () => ({
    default: () => ({ t: (key: string) => key }),
}))
mock.module('@rentnerkev/tooltips', () => ({
    CustomTooltip: ({ children }: { children: ReactNode }) => children,
}))
mock.module('@/shared/SafeDeleteModal/index.tsx', () => ({
    default: () => null,
}))
mock.module('@/features/AppStore/Hooks/useStoreLogoLogic.ts', () => ({
    default: () => logo,
}))
mock.module('@/features/AppStore/Hooks/useStoreScreenshotsLogic.ts', () => ({
    default: () => screenshots,
}))
mock.module('@/features/AppStore/Hooks/useStoreDescriptionLogic.ts', () => ({
    default: () => description,
}))

const { default: ImageCropDialog } =
    await import('@/shared/Images/Components/ImageCropDialog.tsx')
const { default: StoreLogoEditor } =
    await import('@/features/AppStore/Components/StoreLogoEditor.tsx')
const { default: StoreScreenshotsEditor } =
    await import('@/features/AppStore/Components/StoreScreenshotsEditor.tsx')
const { default: StoreDescriptionEditor } =
    await import('@/features/AppStore/Components/StoreDescriptionEditor.tsx')

type AnyProps = Record<string, unknown> & { children?: ReactNode }

/** Expands function components and collects every host element. */
function collect(node: ReactNode, found: Array<ReactElement<AnyProps>> = []) {
    if (Array.isArray(node)) {
        for (const child of node) collect(child, found)
        return found
    }
    if (!isValidElement<AnyProps>(node)) return found
    if (typeof node.type === 'function') {
        const render = node.type as (props: AnyProps) => ReactNode
        return collect(render(node.props), found)
    }
    found.push(node)
    collect(node.props.children, found)
    return found
}

function elementsWith(root: ReactNode, prop: string) {
    return collect(root).filter((element) => prop in element.props)
}

function call(
    element: ReactElement<AnyProps> | undefined,
    prop: string,
    ...args: Array<unknown>
) {
    const handler = element?.props[prop]
    if (typeof handler !== 'function') throw new Error(`missing ${prop}`)
    return Reflect.apply(handler, undefined, args)
}

const fileEvent = {
    target: { files: [new File(['x'], 'shot.png')], value: 'shot.png' },
}

beforeEach(() => {
    for (const group of [
        logo.handler,
        screenshots.handler,
        description.handler,
    ]) {
        for (const handler of Object.values(group)) handler.mockClear()
    }
    logo.state.imageSrc = null
    screenshots.state.imageSrc = null
})

afterEach(restoreTestGlobals)

describe('store editor event handlers', () => {
    it('forwards zoom slider changes from the crop dialog', () => {
        stubTestGlobal('document', { body: {} })
        const onZoomChange = mock()
        const tree = ImageCropDialog({
            titleId: 'crop',
            title: 'Crop',
            hint: 'Hint',
            imageSrc: 'data:image/png;base64,AAAA',
            crop: { x: 0, y: 0 },
            zoom: 1,
            aspect: 1,
            isSaving: false,
            saveLabel: 'Save',
            onCropChange: mock(),
            onZoomChange,
            onCropComplete: mock(),
            onCancel: mock(),
            onSave: mock(),
        })
        call(elementsWith(tree, 'onChange')[0], 'onChange', {
            target: { value: '2.5' },
        })
        expect(onZoomChange).toHaveBeenCalledWith(2.5)
    })

    it('selects a logo file and resets the input for the next pick', () => {
        const tree = StoreLogoEditor({
            appId: 'rentner.weather',
            logoSrc: null,
            name: 'Wetter',
        })
        const event = structuredClone({ target: { value: 'logo.png' } })
        call(elementsWith(tree, 'onChange')[0], 'onChange', {
            target: Object.assign(event.target, {
                files: fileEvent.target.files,
            }),
        })
        expect(logo.handler.handleSelectImage).toHaveBeenCalledWith(
            fileEvent.target.files[0],
        )
        expect(event.target.value).toBe('')
    })

    it('moves, removes and adds screenshots', () => {
        const tree = StoreScreenshotsEditor({
            appId: 'rentner.weather',
            screenshots: [
                { id: 'a', src: '/a.webp' },
                { id: 'b', src: '/b.webp' },
            ],
        })
        const clickable = elementsWith(tree, 'onClick')
        for (const element of clickable) call(element, 'onClick')
        expect(screenshots.handler.handleMove).toHaveBeenCalledWith(0, -1)
        expect(screenshots.handler.handleMove).toHaveBeenCalledWith(1, 1)
        expect(screenshots.handler.handleOpenRemove).toHaveBeenCalledWith('b')
        call(elementsWith(tree, 'onChange').at(-1), 'onChange', {
            target: { files: [], value: '' },
        })
        expect(screenshots.handler.handleSelectImage).toHaveBeenCalledWith(null)
    })

    it('passes typed descriptions to the logic hook', () => {
        const tree = StoreDescriptionEditor({
            appId: 'rentner.weather',
            description: 'Hi',
        })
        call(elementsWith(tree, 'onChange')[0], 'onChange', {
            target: { value: 'Neu' },
        })
        expect(description.handler.handleChange).toHaveBeenCalledWith('Neu')
    })
})
