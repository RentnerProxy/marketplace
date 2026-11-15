export function hasControlCharacters(value: string) {
    // oxlint-disable-next-line no-control-regex -- C0-Steuerzeichen und DEL sollen absichtlich erkannt werden.
    return /[\u0000-\u001f\u007f]/.test(value)
}
