import {
    requireReleaseChangelog,
    renderReleaseBlogNotes,
} from './release-blog.ts'
import { releaseIdentity } from './release-identity.ts'

const START = '<!-- marketplace:release:start -->'
const END = '<!-- marketplace:release:end -->'

function banner(tag: string, revision: string, building = false) {
    const { channel } = releaseIdentity(tag)
    if (!/^[a-f0-9]{40}$/.test(revision))
        throw new Error('Expected an immutable release media revision')
    const name = building
        ? 'building-release-banner.png'
        : channel === 'alpha' || channel === 'beta'
          ? `${channel}-release-banner.png`
          : 'new-release-banner.png'
    return `https://raw.githubusercontent.com/RentnerProxy/marketplace/${revision}/.github/assets/release-banners/${name}`
}

export function releasePublication(tag: string) {
    const identity = releaseIdentity(tag)
    // The first Marketplace alpha is explicitly published as a regular Latest
    // GitHub release; its version and OCI alpha channel retain their identity.
    const prerelease = tag === 'v1.0.0-alpha.1' ? false : identity.prerelease
    return { prerelease, make_latest: prerelease ? 'false' : 'true' }
}

export function replaceReleasePresentation(body: string, content: string) {
    const starts = body.split(START).length - 1
    const ends = body.split(END).length - 1
    if (starts === 0 && ends === 0) return body + (body ? '\n\n' : '') + content
    const start = body.indexOf(START)
    const end = body.indexOf(END)
    if (starts !== 1 || ends !== 1 || end < start)
        throw new Error(
            'Existing machine-owned release presentation is ambiguous',
        )
    return body.slice(0, start) + content + body.slice(end + END.length)
}

export function renderReleaseStatus(
    tag: string,
    revision: string,
    status: 'building' | 'failed',
    runUrl: string,
) {
    if (
        !/^https:\/\/github\.com\/RentnerProxy\/marketplace\/actions\/runs\/[1-9][0-9]*$/.test(
            runUrl,
        )
    )
        throw new Error('Expected the official release workflow URL')
    return [
        START,
        `![New Version is Building](${banner(tag, revision, true)})`,
        '',
        status === 'building'
            ? '# 🚧 New Version is Building'
            : '# ⚠️ Release build interrupted',
        '',
        `**RentnerProxy Marketplace \`${tag}\` ${status === 'building' ? 'is building and being verified.' : 'has not finished building.'}**`,
        '',
        status === 'building'
            ? 'The image, complete release notes and changelog will appear here as soon as all checks and publication succeed.'
            : 'A release check or publication failed. The release image is not confirmed ready. Follow the workflow for the failure and retry status.',
        '',
        `[Follow the release build](${runUrl})`,
        END,
    ].join('\n')
}

export function renderReleasePresentation(
    tag: string,
    revision: string,
    changelog: unknown,
    generatedNotes: string,
    imageSection: string,
) {
    const post = requireReleaseChangelog([changelog], tag)
    const { channel } = releaseIdentity(tag)
    const source = `https://github.com/RentnerProxy/marketplace/blob/${tag}`
    return [
        START,
        `![RentnerProxy Marketplace release](${banner(tag, revision)})`,
        '',
        `# ${channel === 'latest' ? '🚀' : '🧪'} RentnerProxy Marketplace \`${tag}\``,
        '',
        `> **${channel === 'latest' ? 'Release' : channel.charAt(0).toUpperCase() + channel.slice(1) + ' Release'}** · Published **${post.publishedAt}**`,
        '',
        renderReleaseBlogNotes(post, generatedNotes),
        '',
        '## 📦 Installation & downloads',
        '',
        'The complete Docker appliance is available for **Linux AMD64**.',
        '',
        '| Channel | Image |',
        '| --- | --- |',
        `| ${channel} | \`ghcr.io/rentnerproxy/marketplace:${channel}\` |`,
        `| Version | \`ghcr.io/rentnerproxy/marketplace:${tag}\` |`,
        '',
        '```bash',
        `docker pull ghcr.io/rentnerproxy/marketplace:${tag}`,
        '```',
        '',
        `[Compose setup](${source}/README.md) · [Operations and recovery](${source}/docker/README.md) · [Download changelog](https://github.com/RentnerProxy/marketplace/releases/download/${tag}/Marketplace-${tag}-CHANGELOG.md)`,
        '',
        imageSection,
        END,
    ].join('\n')
}
