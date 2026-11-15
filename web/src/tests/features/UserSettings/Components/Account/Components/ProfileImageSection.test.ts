import { beforeEach, describe, expect, it, mock } from 'bun:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import ProfileImageSection from '@/features/UserSettings/Components/Account/Components/ProfileImageSection.tsx'
import type useProfileImageSettingsLogic from '@/features/UserSettings/Components/Account/Hooks/useProfileImageSettingsLogic.ts'
import {
    findElement,
    invoke,
} from '@/tests/shared/RouteErrorComponent/renderHelpers.ts'

let logic: ReturnType<typeof useProfileImageSettingsLogic>
mock.module('@/language/useTranslationStore.ts', () => ({
    default: () => ({
        t: (key: string, values?: Record<string, unknown>) =>
            key + (values ? JSON.stringify(values) : ''),
    }),
}))
mock.module(
    '@/features/UserSettings/Components/Account/Hooks/useProfileImageSettingsLogic.ts',
    () => ({ default: () => logic }),
)
mock.module('@/shared/Images/Hooks/useResolvedImageSrc.ts', () => ({
    default: (src: string) => ({
        state: { imageSrc: src },
        handler: { handleImageError: mock() },
    }),
}))
mock.module('react-easy-crop', () => ({
    default: ({ image }: { image: string }) =>
        createElement('img', { src: image, alt: 'Selected crop' }),
}))
const props = {
    profileImageSrc: '/profile.png',
    userId: 'user-123',
    username: 'Kevin',
}

beforeEach(() => {
    logic = {
        state: {
            copy: false,
            crop: { x: 0, y: 0 },
            imageSrc: null,
            isSavingProfileImage: false,
            zoom: 1,
        },
        handler: {
            handleCopy: mock(),
            handleCropChange: mock(),
            handleCropComplete: mock(),
            handleResetSelectedImage: mock(),
            handleSaveProfileImage: mock(),
            handleSelectImage: mock(),
            handleZoomChange: mock(),
        },
    }
})

describe('ProfileImageSection', () => {
    it('renders the current image with username alt and an empty selection prompt', () => {
        const html = renderToStaticMarkup(
            createElement(ProfileImageSection, props),
        )
        expect(html).toContain('alt="Kevin"')
        expect(html).toContain('src="/profile.png"')
        expect(html).toContain('user-123')
        expect(html).toContain('userSettings.profileImage.empty')
        expect(html).not.toContain('type="range"')
    })

    it('uses the default image for a missing profile and renders copied feedback', () => {
        logic.state.copy = true
        const html = renderToStaticMarkup(
            createElement(ProfileImageSection, {
                ...props,
                profileImageSrc: '',
            }),
        )
        expect(html).toContain('lucide-check')
        expect(html).not.toContain('src=""')
        expect(html).toContain('userSettings.profileImage.userId')
    })

    it('renders selected crop and a disabled saving button', () => {
        logic.state.imageSrc = 'data:image/png;base64,selected'
        logic.state.isSavingProfileImage = true
        const html = renderToStaticMarkup(
            createElement(ProfileImageSection, props),
        )
        expect(html).toContain('Selected crop')
        expect(html).toContain('type="range"')
        expect(html).toContain('min="1" max="3" step="0.1"')
        expect(html).toContain('common.saving')
        expect(html).toContain('disabled=""')
        expect(html).not.toContain('userSettings.profileImage.empty')
    })

    it('forwards upload, cancellation, numeric zoom, copy and save actions', () => {
        logic.state.imageSrc = 'data:image/png;base64,selected'
        const tree = ProfileImageSection(props)
        const file = new File(['png'], 'avatar.png', { type: 'image/png' })
        const upload = findElement(
            tree,
            (element) => element.props.type === 'file',
        )
        invoke(upload, 'onChange', { target: { files: [file] } })
        invoke(upload, 'onChange', { target: { files: null } })
        invoke(
            findElement(tree, (element) => element.props.type === 'range'),
            'onChange',
            { target: { value: '1.8' } },
        )
        invoke(
            findElement(
                tree,
                (element) => element.props.onClick === logic.handler.handleCopy,
            ),
            'onClick',
        )
        invoke(
            findElement(
                tree,
                (element) =>
                    element.props.onClick ===
                    logic.handler.handleResetSelectedImage,
            ),
            'onClick',
        )
        invoke(
            findElement(
                tree,
                (element) =>
                    element.props.onClick ===
                    logic.handler.handleSaveProfileImage,
            ),
            'onClick',
        )
        expect(logic.handler.handleSelectImage).toHaveBeenNthCalledWith(1, file)
        expect(logic.handler.handleSelectImage).toHaveBeenNthCalledWith(2, null)
        expect(logic.handler.handleZoomChange).toHaveBeenCalledWith(1.8)
        expect(logic.handler.handleCopy).toHaveBeenCalledTimes(1)
        expect(logic.handler.handleResetSelectedImage).toHaveBeenCalledTimes(1)
        expect(logic.handler.handleSaveProfileImage).toHaveBeenCalledTimes(1)
    })
})
