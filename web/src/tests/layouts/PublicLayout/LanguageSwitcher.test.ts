import { beforeEach, expect, it, vi } from 'bun:test'
import { createElement, type ReactElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { hookReact, renderHook, resetHooks } from '../hook-harness.ts'
import { FLAG_IMAGES } from '@/config/language.config.ts'
import type { AppLanguage } from '@/shared/Types/config.types.ts'

type Option = { value: AppLanguage; label: string }
type SelectProps = {
    'aria-label': string
    'aria-busy': boolean
    value: AppLanguage
    options: Array<Option>
    readOnly: boolean
    searchable: boolean
    onValueChange: (value: AppLanguage) => void
    classNames: { trigger: string }
    renderValue: (options: Array<Option>) => ReactNode
    renderOption: (option: Option) => ReactNode
}

const setLanguage = vi.fn(async (_language: AppLanguage) => {})
const reportError = vi.fn()

vi.mock('react', () => hookReact)
vi.mock('@rentnerkev/select', () => ({
    CustomSelect: (props: SelectProps) =>
        createElement(
            'div',
            { role: 'listbox', 'aria-label': props['aria-label'] },
            props.renderValue(
                props.options.filter((option) => option.value === props.value),
            ),
            props.options.map((option) =>
                createElement(
                    'div',
                    { key: option.value, role: 'option' },
                    props.renderOption(option),
                ),
            ),
        ),
}))
vi.mock('@/shared/Errors/toastAppError.ts', () => ({
    toastAppError: reportError,
}))
vi.mock('@/language/useTranslationStore.ts', () => ({
    default: () => ({
        availableLanguages: ['de', 'en', 'pl'],
        language: 'de',
        setLanguage,
        t: (key: string) => key,
    }),
}))

const { default: LanguageSwitcher } =
    await import('@/layouts/PublicLayout/Components/LanguageSwitcher.tsx')

function renderSwitcher(tone?: 'dark' | 'light') {
    return renderHook(() =>
        LanguageSwitcher({ tone }),
    ) as ReactElement<SelectProps>
}

beforeEach(() => {
    resetHooks()
    vi.clearAllMocks()
    setLanguage.mockResolvedValue(undefined)
})

it('offers every available language with its flag and native name', () => {
    const select = renderSwitcher()
    expect(select.props['aria-label']).toBe('marketplace.footerLanguage')
    expect(select.props.value).toBe('de')
    expect(select.props.searchable).toBe(false)
    expect(select.props.readOnly).toBe(false)
    expect(select.props.options).toEqual([
        { value: 'de', label: 'Deutsch' },
        { value: 'en', label: 'English' },
        { value: 'pl', label: 'Polski' },
    ])

    const html = renderToStaticMarkup(select)
    expect(html).toContain('aria-label="marketplace.footerLanguage"')
    expect(html.split(`src="${FLAG_IMAGES.de}"`)).toHaveLength(3)
    expect(html).toContain(`src="${FLAG_IMAGES.pl}"`)
    expect(html).toContain('<span lang="pl" class="truncate">Polski</span>')
    expect(html).toContain('sm:not-sr-only sm:truncate">Deutsch</span>')
})

it('matches the trigger shadow and focus outline to the surrounding tone', () => {
    expect(renderSwitcher().props.classNames.trigger).toContain(
        'var(--color-proxy-500)',
    )
    expect(renderSwitcher().props.classNames.trigger).toContain(
        'focus-visible:outline-white',
    )
    const light = renderSwitcher('light').props.classNames.trigger
    expect(light).toContain('shadow-[3px_3px_0_0_var(--color-ink)]')
    expect(light).toContain('focus-visible:outline-ink')
})

it('switches the language from the selection and locks the control meanwhile', async () => {
    const pending = Promise.withResolvers<void>()
    setLanguage.mockReturnValueOnce(pending.promise)

    renderSwitcher().props.onValueChange('en')
    expect(setLanguage).toHaveBeenCalledWith('en')
    const locked = renderSwitcher()
    expect(locked.props.readOnly).toBe(true)
    expect(locked.props['aria-busy']).toBe(true)

    pending.resolve()
    await pending.promise
    await Promise.resolve()
    expect(renderSwitcher().props.readOnly).toBe(false)
    expect(reportError).not.toHaveBeenCalled()
})

it('reports a failed language switch and unlocks the control again', async () => {
    const failure = new Error('Language unavailable')
    setLanguage.mockRejectedValueOnce(failure)

    renderSwitcher().props.onValueChange('pl')
    await Promise.resolve()
    await Promise.resolve()

    expect(reportError).toHaveBeenCalledWith(failure)
    expect(renderSwitcher().props.readOnly).toBe(false)
})
