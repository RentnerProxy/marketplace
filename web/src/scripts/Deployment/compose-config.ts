export function parseComposeConfigOutput(output: string): unknown {
    // Compose escapes dollars after serialization so its output can be reused as input.
    return JSON.parse(output.replaceAll('$$', '$'))
}
