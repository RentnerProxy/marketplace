export function scheduleCancelableTimeout(
    callback: () => void,
    delayMs: number,
): () => void {
    const timer = window.setTimeout(callback, delayMs)
    return () => window.clearTimeout(timer)
}
