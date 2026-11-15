import { lstat, readFile } from 'node:fs/promises'
import { record } from '../automation/github.ts'
import { releaseIdentity } from './release-identity.ts'
import type { ReleaseBlogPost } from './Types/release-blog.types.ts'

const BLOG_DATA = new URL(
    '../../../web/src/features/MarketplaceBlog/marketplace-blog.posts.json',
    import.meta.url,
)
const MAX_DATA_BYTES = 4 * 1024 * 1024

function text(value: unknown, maximum: number, multiline = false): string {
    if (typeof value !== 'string')
        throw new Error('Release blog content is missing or exceeds its limit')
    const normalized = value.trim()
    if (!normalized || normalized.length > maximum)
        throw new Error('Release blog content is missing or exceeds its limit')
    if (
        normalized.includes('<!-- marketplace:') ||
        normalized.split('').some((character) => {
            const code = character.charCodeAt(0)
            return (
                code === 127 ||
                (code < 32 && (!multiline || (code !== 9 && code !== 10)))
            )
        })
    )
        throw new Error(
            'Release blog content contains reserved markers or control characters',
        )
    return normalized
}

function exactRecord(value: unknown, keys: string[]): Record<string, unknown> {
    const object = record(value)
    if (Object.keys(object).some((key) => !keys.includes(key)))
        throw new Error('Release blog content contains unknown fields')
    return object
}

function article(value: unknown): ReleaseBlogPost['content']['en'] {
    const content = exactRecord(value, ['title', 'summary', 'body'])
    if (
        !Array.isArray(content.body) ||
        content.body.length < 1 ||
        content.body.length > 64
    )
        throw new Error(
            'Release blog body must contain between one and 64 paragraphs',
        )
    const body = content.body.map((paragraph: unknown) =>
        text(paragraph, 8000, true),
    )
    if (
        body.reduce((length, paragraph) => length + paragraph.length, 0) > 48000
    )
        throw new Error('Release blog body exceeds its total length limit')
    return {
        title: text(content.title, 160),
        summary: text(content.summary, 1200),
        body,
    }
}

export function requireReleaseChangelog(
    dataset: unknown,
    tag: string,
): ReleaseBlogPost {
    releaseIdentity(tag)
    if (!Array.isArray(dataset))
        throw new Error('Release blog data must be an array')
    const posts = dataset.map(record)
    if (new Set(posts.map((post) => post.id)).size !== posts.length)
        throw new Error('Release blog post IDs must be unique')
    const matches = posts.filter(
        (post) =>
            post.releaseTag === tag &&
            post.kind === 'published' &&
            post.category === 'changelog',
    )
    if (matches.length !== 1)
        throw new Error(
            'Release requires exactly one published changelog for this tag',
        )
    const post = matches[0]
    if (!post) throw new Error('Release changelog is missing')
    exactRecord(post, [
        'kind',
        'id',
        'category',
        'releaseTag',
        'version',
        'publishedAt',
        'content',
    ])
    const id = text(post.id, 160)
    if (post.id !== id || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id))
        throw new Error('Release blog slug is invalid')
    if (post.version !== tag.slice(1))
        throw new Error('Release blog version does not match the tag')
    const publishedAt = text(post.publishedAt, 10)
    const timestamp = Date.parse(publishedAt + 'T00:00:00Z')
    if (
        post.publishedAt !== publishedAt ||
        !/^\d{4}-\d{2}-\d{2}$/.test(publishedAt) ||
        !Number.isFinite(timestamp) ||
        new Date(timestamp).toISOString().slice(0, 10) !== publishedAt
    )
        throw new Error('Release blog publication date is invalid')
    const content = exactRecord(post.content, [
        'en',
        'de',
        'es',
        'fr',
        'it',
        'pt',
        'nl',
        'pl',
    ])
    const english = article(content.en)
    for (const localized of Object.values(content))
        if (localized !== undefined) article(localized)
    return {
        kind: 'published',
        id,
        category: 'changelog',
        releaseTag: tag,
        version: tag.slice(1),
        publishedAt,
        content: { en: english },
    }
}

export async function loadReleaseChangelog(
    tag: string,
): Promise<ReleaseBlogPost> {
    releaseIdentity(tag)
    const info = await lstat(BLOG_DATA)
    if (!info.isFile() || info.size > MAX_DATA_BYTES)
        throw new Error(
            'Release blog dataset must be a bounded regular JSON file',
        )
    const bytes = await readFile(BLOG_DATA)
    if (bytes.byteLength > MAX_DATA_BYTES)
        throw new Error('Release blog dataset exceeds its size limit')
    let data: unknown
    try {
        data = JSON.parse(
            new TextDecoder('utf-8', { fatal: true }).decode(bytes),
        )
    } catch {
        throw new Error('Release blog dataset is not valid UTF-8 JSON')
    }
    return requireReleaseChangelog(data, tag)
}

export function renderReleaseBlogNotes(
    post: ReleaseBlogPost,
    generatedNotes: string,
): string {
    const authored = [post.content.en.summary, ...post.content.en.body].join(
        '\n\n',
    )
    return generatedNotes.trim()
        ? authored + '\n\n## GitHub-generated changes\n\n' + generatedNotes
        : authored
}

if (import.meta.main) {
    await loadReleaseChangelog(process.env.RELEASE_TAG ?? '')
    console.log('Exact-tag published release changelog validated.')
}
