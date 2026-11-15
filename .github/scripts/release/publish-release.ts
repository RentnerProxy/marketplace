import {
    createGitHubRequest,
    GitHubRequestError,
    record,
} from '../automation/github.ts'
import { releaseIdentity } from './release-identity.ts'

const IMAGE_START = '<!-- marketplace:appliance:start -->'
const IMAGE_END = '<!-- marketplace:appliance:end -->'

function imageSection(body: string, image: string, channel: string): string {
    const section = `${IMAGE_START}\n### Appliance image\n\n\`${image}\`\n\nChannel: \`${channel}\`\n${IMAGE_END}`
    const starts = body.split(IMAGE_START).length - 1
    const ends = body.split(IMAGE_END).length - 1
    if (starts === 0 && ends === 0) return body + (body ? '\n\n' : '') + section
    const start = body.indexOf(IMAGE_START)
    const end = body.indexOf(IMAGE_END)
    if (starts !== 1 || ends !== 1 || end < start)
        throw new Error('Existing machine-owned appliance section is ambiguous')
    return body.slice(0, start) + section + body.slice(end + IMAGE_END.length)
}

export async function publishRelease(
    request: ReturnType<typeof createGitHubRequest>,
    tag: string,
    image: string,
) {
    const identity = releaseIdentity(tag)
    if (
        !/^ghcr\.io\/rentnerproxy\/marketplace@sha256:[a-f0-9]{64}$/.test(image)
    )
        throw new Error('Expected the exact verified Marketplace image digest')
    const prefix = '/repos/rentnerproxy/marketplace/releases'
    let existing: Record<string, unknown> | undefined
    try {
        existing = record(
            await request('GET', `${prefix}/tags/${encodeURIComponent(tag)}`),
        )
    } catch (error) {
        if (!(error instanceof GitHubRequestError && error.status === 404))
            throw error
    }
    if (existing) {
        if (
            existing.tag_name !== tag ||
            typeof existing.id !== 'number' ||
            !Number.isSafeInteger(existing.id) ||
            existing.id <= 0
        )
            throw new Error('Existing release identity is invalid')
        if (existing.body !== null && typeof existing.body !== 'string')
            throw new Error('Existing release body is invalid')
        // Omitting metadata fields preserves the maintainer title and draft/published state.
        await request('PATCH', `${prefix}/${existing.id}`, {
            body: imageSection(existing.body ?? '', image, identity.channel),
        })
        return
    }
    const notes = record(
        await request('POST', `${prefix}/generate-notes`, { tag_name: tag }),
    )
    if (typeof notes.body !== 'string')
        throw new Error('GitHub did not generate release notes')
    await request('POST', prefix, {
        tag_name: tag,
        name: tag,
        body: imageSection(notes.body, image, identity.channel),
        draft: false,
        prerelease: identity.prerelease,
        make_latest: identity.prerelease ? 'false' : 'true',
    })
}

if (import.meta.main) {
    if (process.env.GITHUB_REPOSITORY !== 'RentnerProxy/marketplace')
        throw new Error(
            'Release publication is limited to the Marketplace repository',
        )
    await publishRelease(
        createGitHubRequest(
            'RentnerProxy/marketplace',
            process.env.GH_TOKEN ?? '',
        ),
        process.env.RELEASE_TAG ?? '',
        process.env.RELEASE_IMAGE ?? '',
    )
    console.log('Native GitHub Release appliance metadata updated.')
}
