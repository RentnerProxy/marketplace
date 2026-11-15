import { beforeEach, expect, it, vi } from 'bun:test'
import type { SyntheticEvent } from 'react'
import {
    hookReact,
    renderHook,
    resetHooks,
} from '../../../layouts/hook-harness.ts'

vi.mock('react', () => hookReact)
const { default: useImage } =
    await import('@/shared/Images/Hooks/useResolvedImageSrc.ts')
function errorEvent(src: string, currentSrc = '') {
    return {
        currentTarget: { src, currentSrc },
    } as SyntheticEvent<HTMLImageElement>
}
beforeEach(resetHooks)
const render = () =>
    renderHook(() => useImage('/image-one.png', '/fallback.png'))

it('switches a failed image to fallback, remembers the failure, and stops retrying a broken fallback', () => {
    expect(render().state.imageSrc).toBe('/image-one.png')
    render().handler.handleImageError(errorEvent('/image-one.png'))
    expect(render().state.imageSrc).toBe('/fallback.png')
    resetHooks()
    expect(render().state.imageSrc).toBe('/fallback.png')
    render().handler.handleImageError(errorEvent('/fallback.png'))
    expect(render().state.imageSrc).toBe('')
})

it('resolves new sources and fallback changes and uses currentSrc from responsive images', () => {
    renderHook(() =>
        useImage('/image-two.png', '/fallback.png'),
    ).handler.handleImageError(errorEvent('', '/responsive.png'))
    expect(
        renderHook(() => useImage('/image-three.png', '/new-fallback.png'))
            .state.imageSrc,
    ).toBe('/image-three.png')
    expect(
        renderHook(() => useImage('/responsive.png', '/new-fallback.png')).state
            .imageSrc,
    ).toBe('/new-fallback.png')
})
