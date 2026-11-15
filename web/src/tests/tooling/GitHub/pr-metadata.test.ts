import { describe, expect, test } from 'bun:test'
import { validateTitle } from '../../../../../.github/scripts/automation/pr-metadata.ts'

describe('PR title validation', () => {
    test.each([
        'feat: add marketplace foundation',
        'fix(core): handle shutdown',
        'chore(deps): bump bun',
        'feat!: change catalog contract',
    ])('accepts %s', (title) => {
        expect(validateTitle(title)).toBe(true)
    })
    test.each([
        'update stuff',
        'fix:   ',
        'fix(): missing scope',
        'fix:',
        'fix: value\r',
        'Feat: add thing',
        'fix: valid\nmalicious: value',
        '',
        undefined,
    ])('rejects invalid title %s', (title) => {
        expect(validateTitle(title)).toBe(false)
    })
})
