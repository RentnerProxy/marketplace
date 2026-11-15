export function releaseIdentity(tag: string) {
    if (
        !/^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(-(alpha|beta|rc)\.(0|[1-9]\d*))?$/.test(
            tag,
        )
    )
        throw new Error('Expected an official vSemVer release tag')
    const prerelease = tag.includes('-')
    const channel = tag.includes('-alpha.')
        ? 'alpha'
        : tag.includes('-beta.')
          ? 'beta'
          : tag.includes('-rc.')
            ? 'rc'
            : 'latest'
    return { tag, prerelease, channel }
}

if (import.meta.main) {
    console.log(releaseIdentity(process.env.RELEASE_TAG ?? '').channel)
}
