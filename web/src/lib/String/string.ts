export function truncateNullableText(
    value: string | null | undefined,
    max: number,
) {
    if (!value) {
        return null
    }

    return value.slice(0, max)
}
