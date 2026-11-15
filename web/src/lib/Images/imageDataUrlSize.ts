export function getDataUrlByteSize(dataUrl: string) {
    const base64 = dataUrl.split(',')[1] ?? ''
    const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0

    return Math.max(0, Math.floor((base64.length * 3) / 4) - padding)
}
