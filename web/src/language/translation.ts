import en from './Locales/en.json'

type DottedLeaves<Dictionary> = {
    [Key in keyof Dictionary & string]: Dictionary[Key] extends string
        ? Key
        : `${Key}.${DottedLeaves<Dictionary[Key]>}`
}[keyof Dictionary & string]

export type TranslationKey = DottedLeaves<typeof en>
type TranslationValue = string | number | boolean | bigint | null | undefined
export type Translate = (
    key: TranslationKey,
    values?: Record<string, TranslationValue>,
) => string

export type Messages = { readonly [key: string]: string | Messages }

function findMessage(messages: Messages, key: string) {
    const value = key
        .split('.')
        .reduce<string | Messages | undefined>(
            (current, segment) =>
                typeof current === 'object' && Object.hasOwn(current, segment)
                    ? current[segment]
                    : undefined,
            messages,
        )
    return typeof value === 'string' ? value : undefined
}

export function isTranslationKey(key: string): key is TranslationKey {
    return findMessage(en, key) !== undefined
}

export function createTranslator(messages: Messages = en): Translate {
    return function translate(key, values) {
        const message =
            findMessage(messages, key) ?? findMessage(en, key) ?? key

        return message.replace(
            /\{\{\s*(\w+)\s*\}\}/g,
            (placeholder: string, name: string) =>
                values && Object.hasOwn(values, name)
                    ? String(values[name] ?? '')
                    : placeholder,
        )
    }
}
