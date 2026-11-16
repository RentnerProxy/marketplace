import {
    createGitHubRequest,
    GitHubRequestError,
    record,
} from '../automation/github.ts'
import { releaseIdentity } from './release-identity.ts'
import {
    loadReleaseChangelog,
    requireReleaseChangelog,
} from './release-blog.ts'
import {
    releasePublication,
    renderReleasePresentation,
    renderReleaseStatus,
    replaceReleasePresentation,
} from './release-presentation.ts'
import { join } from 'node:path'

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
    changelog: unknown,
    revision: string,
    mode: 'prepare' | 'publish' = 'publish',
) {
    const identity = releaseIdentity(tag)
    const post = requireReleaseChangelog([changelog], tag)
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
        let body = existing.body ?? ''
        if (
            body.includes('<!-- marketplace:release:start -->') &&
            !body.includes(IMAGE_START)
        ) {
            const notes = record(
                await request('POST', `${prefix}/generate-notes`, {
                    tag_name: tag,
                }),
            )
            if (typeof notes.body !== 'string')
                throw new Error('GitHub did not generate release notes')
            body = replaceReleasePresentation(
                body,
                renderReleasePresentation(
                    tag,
                    revision,
                    post,
                    notes.body,
                    imageSection('', image, identity.channel),
                ),
            )
        } else body = imageSection(body, image, identity.channel)
        if (mode === 'publish')
            await request('PATCH', `${prefix}/${existing.id}`, { body })
        return body
    }
    const notes = record(
        await request('POST', `${prefix}/generate-notes`, { tag_name: tag }),
    )
    if (typeof notes.body !== 'string')
        throw new Error('GitHub did not generate release notes')
    const body = renderReleasePresentation(
        tag,
        revision,
        post,
        notes.body,
        imageSection('', image, identity.channel),
    )
    if (mode === 'publish')
        await request('POST', prefix, {
            tag_name: tag,
            name: post.content.en.title,
            body,
            draft: false,
            ...releasePublication(tag),
        })
    return body
}

export async function publishReleaseStatus(
    request: ReturnType<typeof createGitHubRequest>,
    tag: string,
    revision: string,
    changelog: unknown,
    status: 'building' | 'failed',
    runUrl: string,
) {
    const post = requireReleaseChangelog([changelog], tag)
    const prefix = '/repos/rentnerproxy/marketplace/releases'
    const content = renderReleaseStatus(tag, revision, status, runUrl)
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
            existing.id <= 0 ||
            (existing.body !== null && typeof existing.body !== 'string')
        )
            throw new Error('Existing release identity is invalid')
        const body = existing.body ?? ''
        // A successful publication must never regress to a build placeholder.
        if (body.includes(IMAGE_START)) return
        await request('PATCH', `${prefix}/${existing.id}`, {
            body: replaceReleasePresentation(body, content),
        })
    } else {
        await request('POST', prefix, {
            tag_name: tag,
            name: post.content.en.title,
            body: content,
            draft: false,
            ...releasePublication(tag),
        })
    }
}

if (import.meta.main) {
    if (process.env.GITHUB_REPOSITORY !== 'RentnerProxy/marketplace')
        throw new Error(
            'Release publication is limited to the Marketplace repository',
        )
    const tag = process.env.RELEASE_TAG ?? ''
    const changelog = await loadReleaseChangelog(tag)
    const request = createGitHubRequest(
        'RentnerProxy/marketplace',
        process.env.GH_TOKEN ?? '',
    )
    const revision = process.env.GITHUB_SHA ?? ''
    const mode = process.argv[2] ?? 'complete'
    if (mode === 'building' || mode === 'failed') {
        await publishReleaseStatus(
            request,
            tag,
            revision,
            changelog,
            mode,
            `https://github.com/RentnerProxy/marketplace/actions/runs/${process.env.GITHUB_RUN_ID ?? ''}`,
        )
    } else if (mode === 'complete' || mode === 'prepare') {
        const directory = process.env.RUNNER_TEMP
        if (!directory)
            throw new Error('Runner temporary directory is required')
        const body = await publishRelease(
            request,
            tag,
            process.env.RELEASE_IMAGE ?? '',
            changelog,
            revision,
            mode === 'prepare' ? 'prepare' : 'publish',
        )
        await Bun.write(
            join(directory, `Marketplace-${tag}-CHANGELOG.md`),
            body,
        )
    } else throw new Error('Unknown release publication mode')
    console.log('Native GitHub Release appliance metadata updated.')
}
