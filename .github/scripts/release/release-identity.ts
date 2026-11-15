export function releaseIdentity(tag: string) {
    if (
        !/^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(-(alpha|beta|rc)\.(0|[1-9]\d*))?$/.test(
            tag,
        )
    )
        throw new Error('Expected an official vSemVer release tag')
    const prerelease = tag.includes('-')
    return { tag, prerelease, channel: prerelease ? 'beta' : 'latest' }
}
