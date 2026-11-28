import { beforeEach, describe, expect, it, vi } from 'bun:test'
import type { ToastOptions } from '@rentnerkev/toasts'
import { AppError } from '@/lib/Errors/appError.ts'

const notify = vi.fn(
    (_content: string, _options?: ToastOptions) => 'fixture-toast',
)
vi.mock('@rentnerkev/toasts', () => ({ toast: { error: notify } }))
const translate = vi.fn((_key: string) => 'Fehler')
vi.mock('@/language/languageStore.ts', () => ({
    translateCurrentLanguage: translate,
}))
const { toastAppError } = await import('@/shared/Errors/toastAppError.ts')

beforeEach(() => {
    notify.mockClear()
    translate.mockReset().mockReturnValue('Fehler')
})

describe('toastAppError package integration', () => {
    it('preserves AppError content, title and duration', () => {
        toastAppError(
            new AppError('Nicht gespeichert', {
                title: 'Profil',
                duration: 4321,
            }),
            'Fallback',
        )
        expect(notify).toHaveBeenCalledWith(
            'Nicht gespeichert',
            expect.objectContaining({ title: 'Profil', duration: 4321 }),
        )
    })

    it('keeps readable Error messages and the package duration default', () => {
        toastAppError(new Error('Verbindung unterbrochen'), 'Fallback')
        expect(notify).toHaveBeenCalledWith(
            'Verbindung unterbrochen',
            expect.objectContaining({ title: 'Fehler' }),
        )
        expect(notify.mock.calls[0]?.[1]).not.toHaveProperty('duration')
    })

    it('uses the current locale for plain errors and AppErrors without an explicit title', () => {
        translate.mockReturnValue('Error')
        toastAppError(new Error('Request failed'))
        toastAppError(new AppError('Could not save'))
        expect(notify).toHaveBeenNthCalledWith(
            1,
            'Request failed',
            expect.objectContaining({ title: 'Error' }),
        )
        expect(notify).toHaveBeenNthCalledWith(
            2,
            'Could not save',
            expect.objectContaining({ title: 'Error', duration: 6000 }),
        )
        expect(translate).toHaveBeenCalledWith('common.error')
    })

    for (const { name, value } of [
        { name: 'null', value: null },
        { name: 'an untrusted string', value: 'untrusted raw value' },
        {
            name: 'an untrusted object',
            value: { message: 'untrusted object value' },
        },
        { name: 'an empty Error', value: new Error('') },
        { name: 'a whitespace-only Error', value: new Error('   ') },
    ]) {
        it(`uses the application fallback for ${name}`, () => {
            toastAppError(value, 'Anfrage fehlgeschlagen')
            expect(notify).toHaveBeenCalledWith(
                'Anfrage fehlgeschlagen',
                expect.objectContaining({ title: 'Fehler' }),
            )
        })
    }

    it('groups equivalent failures but separates different titles and messages', () => {
        toastAppError(new AppError('Nicht gespeichert', { title: 'Profil' }))
        toastAppError(new AppError('Nicht gespeichert', { title: 'Profil' }))
        toastAppError(new AppError('Nicht gespeichert', { title: 'System' }))
        toastAppError(new AppError('Nicht geladen', { title: 'Profil' }))
        toastAppError(new AppError('C', { title: 'A:B' }))
        toastAppError(new AppError('B:C', { title: 'A' }))
        const keys = notify.mock.calls.map((call) => call[1]?.dedupeKey)
        expect(keys[0]).toBeTruthy()
        expect(keys[1]).toBe(keys[0])
        expect(keys[2]).not.toBe(keys[0])
        expect(keys[3]).not.toBe(keys[0])
        expect(keys[4]).not.toBe(keys[5])
        expect(
            notify.mock.calls.every((call) => call[1]?.dedupeWindow === 2000),
        ).toBe(true)
    })
})
