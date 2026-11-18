import { runToolingSync } from '../native-tools.ts'

type ReleaseIdentity = {
    tag: string
    prerelease: boolean
    channel: 'latest' | 'alpha' | 'beta' | 'rc'
}

export function releaseIdentity(tag: string) {
    return runToolingSync<ReleaseIdentity>('release-identity', { tag })
}

if (import.meta.main) {
    const [command, first, second, third] = process.argv.slice(2)
    const tag = process.env.RELEASE_TAG ?? ''
    const context = {
        tag,
        repository: process.env.GITHUB_REPOSITORY,
        refType: process.env.GITHUB_REF_TYPE,
        revision: process.env.GITHUB_SHA,
        localRevision: first,
    }
    switch (command) {
        case undefined:
            console.log(releaseIdentity(tag).channel)
            break
        case 'context':
            runToolingSync('release-tag-context', context)
            break
        case 'provenance':
            runToolingSync('release-tag-provenance', {
                ...context,
                remoteRevision: second,
                comparison: third,
            })
            break
        case 'image-id':
            runToolingSync('release-image-id', {
                imageId: process.env.IMAGE_ID,
            })
            break
        case 'existing-image':
            runToolingSync('release-existing-image', {
                imageId: process.env.IMAGE_ID,
                path: first,
            })
            break
        case 'published-image':
            console.log(
                runToolingSync<string>('release-published-image', {
                    versionDigest: first,
                    channelDigest: second,
                }),
            )
            break
        case 'changelog':
            console.log(
                runToolingSync<string>('release-changelog', {
                    tag,
                    directory: process.env.RUNNER_TEMP,
                    published: first,
                }),
            )
            break
        default:
            throw new Error('Unknown release validation command')
    }
}
