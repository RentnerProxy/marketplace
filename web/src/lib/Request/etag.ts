export function matchesIfNoneMatch(header: string | null, etag: string) {
    if (header === null) return false
    if (header.trim() === '*') return true
    const opaqueTag = etag.replace(/^W\//, '')
    for (const [, candidate] of header.matchAll(
        /(?:^|,)\s*(?:W\/)?("[^"]*")\s*(?=,|$)/gu,
    )) {
        if (candidate === opaqueTag) return true
    }
    return false
}
