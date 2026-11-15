import { afterEach, beforeEach, expect, it, vi } from 'bun:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import {
    hookReact,
    renderHook,
    resetHooks,
    runEffects,
} from '../../layouts/hook-harness.ts'
import type { AddressSuggestion } from '@/lib/Address/Types/address.types.ts'

const suggestion: AddressSuggestion = {
    id: 'address-1',
    label: 'Main Street 12, 12345 Town',
    street: 'Main Street',
    houseNumber: '12',
    postalCode: '12345',
    city: 'Town',
}
const search = vi.fn(async (_query: string, _signal: AbortSignal) => [
    suggestion,
])
const onSelect = vi.fn()
const oldWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
vi.mock('react', () => hookReact)
vi.mock('@/lib/Address/addressSearch.ts', () => ({
    searchAddressSuggestions: search,
}))
vi.mock('@/language/useTranslationStore.ts', () => ({
    default: () => ({ t: (key: string) => key }),
}))
const { default: useSearch } =
    await import('@/shared/AddressSearchInput/Hooks/useAddressSearchInputLogic.ts')
const { default: SearchInput } =
    await import('@/shared/AddressSearchInput/index.tsx')
const render = () => renderHook(() => useSearch({ onSelect }))
async function flushSearch() {
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
}

beforeEach(() => {
    resetHooks()
    vi.clearAllMocks()
    vi.useFakeTimers()
    search.mockResolvedValue([suggestion])
    Object.defineProperty(globalThis, 'window', {
        configurable: true,
        value: { setTimeout, clearTimeout },
    })
})
afterEach(() => {
    vi.useRealTimers()
    if (oldWindow) Object.defineProperty(globalThis, 'window', oldWindow)
    else Reflect.deleteProperty(globalThis, 'window')
})

it('requires three characters and debounces a trimmed query before displaying suggestions', async () => {
    render().handler.handleSearchValueChange('ab')
    render()
    runEffects()()
    vi.advanceTimersByTime(350)
    expect(search).not.toHaveBeenCalled()
    render().handler.handleSearchValueChange('  Main  ')
    render()
    const cleanup = runEffects()
    vi.advanceTimersByTime(349)
    expect(search).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(search).toHaveBeenCalledWith('Main', expect.any(AbortSignal))
    await flushSearch()
    expect(render().state.suggestions).toEqual([suggestion])
    expect(render().state.isLoading).toBe(false)
    const html = renderHook(() =>
        renderToStaticMarkup(createElement(SearchInput, { onSelect })),
    )
    expect(html).toContain(suggestion.label)
    expect(html).toContain('type="search"')
    render().handler.handleSelectSuggestion(suggestion)
    expect(onSelect).toHaveBeenCalledWith({
        street: 'Main Street',
        houseNumber: '12',
        postalCode: '12345',
        city: 'Town',
    })
    expect(render().state.searchValue).toBe(suggestion.label)
    expect(render().state.suggestions).toEqual([])
    expect(render().state.hasSearched).toBe(false)
    cleanup()
    expect(search.mock.calls[0]?.[1].aborted).toBe(true)
    expect(vi.getTimerCount()).toBe(0)
})

it.each([new Error('offline'), new DOMException('aborted', 'AbortError')])(
    'handles search failure and cancels pending work on cleanup',
    async (error) => {
        search.mockRejectedValueOnce(error)
        render().handler.handleSearchValueChange('Missing')
        render()
        const cleanup = runEffects()
        vi.advanceTimersByTime(350)
        await flushSearch()
        expect(render().state.suggestions).toEqual([])
        expect(render().state.isLoading).toBe(false)
        expect(
            renderHook(() =>
                renderToStaticMarkup(createElement(SearchInput, { onSelect })),
            ),
        ).toContain('shared.addressSearch.noSuggestions')
        cleanup()
        render().handler.handleSearchValueChange('Another')
        render()
        runEffects()()
        vi.advanceTimersByTime(350)
        expect(search).toHaveBeenCalledTimes(1)
    },
)

it.each(['resolve', 'reject'] as const)(
    'ignores a stale search that settles by %s after cancellation',
    async (outcome) => {
        const stale = Promise.withResolvers<AddressSuggestion[]>()
        search.mockReturnValueOnce(stale.promise)
        render().handler.handleSearchValueChange('Previous')
        render()
        const cancelPrevious = runEffects()
        vi.advanceTimersByTime(350)
        cancelPrevious()

        render().handler.handleSearchValueChange('Current')
        render()
        const cleanup = runEffects()
        vi.advanceTimersByTime(350)
        await flushSearch()
        expect(render().state.suggestions).toEqual([suggestion])

        if (outcome === 'resolve')
            stale.resolve([{ ...suggestion, id: 'stale' }])
        else stale.reject(new Error('Stale request failed'))
        await flushSearch()

        expect(render().state.suggestions).toEqual([suggestion])
        expect(render().state.isLoading).toBe(false)
        cleanup()
    },
)
