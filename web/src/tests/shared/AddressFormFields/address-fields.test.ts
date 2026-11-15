import { beforeEach, expect, it, vi } from 'bun:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { AddressSearchValue } from '@/lib/Address/Types/address.types.ts'

const fields: Array<{
    value: string
    placeholder: string
    maxLength: number
    onChange: (event: { target: { value: string } }) => void
}> = []
let select: (value: AddressSearchValue) => void
const change = vi.fn()
vi.mock('@/language/useTranslationStore.ts', () => ({
    default: () => ({ t: (key: string) => key }),
}))
vi.mock('@rentnerkev/inputs', () => ({
    TextInput: (props: (typeof fields)[number]) => {
        fields.push(props)
        return createElement('input', {
            value: props.value,
            placeholder: props.placeholder,
            maxLength: props.maxLength,
            readOnly: true,
        })
    },
}))
vi.mock('@/shared/AddressSearchInput/index.tsx', () => ({
    default: ({ onSelect }: { onSelect: typeof select }) => {
        select = onSelect
        return createElement('div', null, 'Address search')
    },
}))
const { default: Fields } = await import('@/shared/AddressFormFields/index.tsx')
beforeEach(() => {
    fields.length = 0
    vi.clearAllMocks()
})

it('renders translated address fields and forwards individual changes and suggestion selections', () => {
    const address = {
        street: 'Main',
        houseNumber: '12',
        postalCode: '12345',
        city: 'Town',
    }
    const html = renderToStaticMarkup(
        createElement(Fields, { values: address, onChange: change }),
    )
    expect(html).toContain('Address search')
    expect(html).toContain('userSettings.personalInfo.street')
    expect(fields.map((field) => field.maxLength)).toEqual([100, 20, 20, 100])
    for (const [index, key] of [
        'street',
        'houseNumber',
        'postalCode',
        'city',
    ].entries()) {
        fields[index]?.onChange({ target: { value: 'Changed' } })
        expect(change).toHaveBeenLastCalledWith(key, 'Changed')
    }
    change.mockClear()
    select(address)
    expect(change.mock.calls).toEqual(Object.entries(address))
})

it('uses caller supplied placeholders', () => {
    const placeholders = {
        street: 'Road',
        houseNumber: 'Number',
        postalCode: 'Zip',
        city: 'City',
    }
    const html = renderToStaticMarkup(
        createElement(Fields, {
            values: { street: '', houseNumber: '', postalCode: '', city: '' },
            onChange: change,
            placeholders,
        }),
    )
    for (const value of Object.values(placeholders))
        expect(html).toContain(`placeholder="${value}"`)
})
