export async function forEachSequentially<Value>(
    values: ReadonlyArray<Value>,
    operation: (value: Value, index: number) => Promise<void> | void,
) {
    for (const [index, value] of values.entries()) {
        // oxlint-disable-next-line no-await-in-loop -- Die nächste Operation darf erst nach Abschluss dieser Operation starten.
        await operation(value, index)
    }
}
