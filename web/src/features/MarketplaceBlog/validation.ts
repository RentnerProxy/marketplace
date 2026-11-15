import { z } from 'zod'
import { hasControlCharacters } from '@/lib/Validation/hasControlCharacters.ts'
import type {
    MarketplaceBlogPublishedPost,
    MarketplaceBlogResolvedContent,
    MarketplaceBlogReleaseChannel,
} from './Types/marketplace-blog.types.ts'

const releaseTagSchema = z
    .string()
    .regex(
        /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(-(alpha|beta|rc)\.(0|[1-9]\d*))?$/,
    )
const slugSchema = z
    .string()
    .max(160)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
const languageSchema = z.enum(['en', 'de', 'es', 'fr', 'it', 'pt', 'nl', 'pl'])
const articleContentSchema = z
    .object({
        title: z
            .string()
            .trim()
            .min(1)
            .max(160)
            .refine(
                (value) =>
                    !hasControlCharacters(value) &&
                    !value.includes('<!-- marketplace:'),
                'Title contains reserved characters.',
            ),
        summary: z
            .string()
            .trim()
            .min(1)
            .max(1200)
            .refine(
                (value) =>
                    !hasControlCharacters(value) &&
                    !value.includes('<!-- marketplace:'),
                'Summary contains reserved characters.',
            ),
        body: z
            .array(
                z
                    .string()
                    .trim()
                    .min(1)
                    .max(8000)
                    .refine(
                        (value) =>
                            !hasControlCharacters(
                                value.replaceAll('\n', '').replaceAll('\t', ''),
                            ) && !value.includes('<!-- marketplace:'),
                        'Paragraph contains reserved characters.',
                    ),
            )
            .min(1)
            .max(64),
    })
    .strict()
    .refine(
        (content) =>
            content.body.reduce(
                (length, paragraph) => length + paragraph.length,
                0,
            ) <= 48000,
        'Article body is too long.',
    )
const publishedPostSchema = z
    .object({
        kind: z.literal('published'),
        id: slugSchema,
        category: z.enum(['changelog', 'news']),
        releaseTag: releaseTagSchema,
        version: z.string().min(1),
        publishedAt: z
            .string()
            .regex(/^\d{4}-\d{2}-\d{2}$/)
            .refine((value) => {
                const parsed = new Date(`${value}T00:00:00.000Z`)
                return (
                    Number.isFinite(parsed.getTime()) &&
                    parsed.toISOString().slice(0, 10) === value
                )
            }, 'publishedAt must be a real calendar date.'),
        content: z
            .object({
                en: articleContentSchema,
                de: articleContentSchema.optional(),
                es: articleContentSchema.optional(),
                fr: articleContentSchema.optional(),
                it: articleContentSchema.optional(),
                pt: articleContentSchema.optional(),
                nl: articleContentSchema.optional(),
                pl: articleContentSchema.optional(),
            })
            .strict(),
    })
    .strict()
    .refine(
        (post) => post.releaseTag === `v${post.version}`,
        'releaseTag must match the version.',
    )
const publishedPostsSchema = z
    .array(publishedPostSchema)
    .superRefine((posts, context) => {
        const ids = new Set<string>()
        for (const [index, post] of posts.entries()) {
            if (ids.has(post.id))
                context.addIssue({
                    code: 'custom',
                    path: [index, 'id'],
                    message: 'Published post IDs must be unique.',
                })
            ids.add(post.id)
        }
    })

export function parseMarketplaceBlogPublishedPosts(
    input: unknown,
): readonly MarketplaceBlogPublishedPost[] {
    return publishedPostsSchema.parse(input)
}

export function findMarketplaceBlogPublishedPost(
    slug: unknown,
    posts: readonly MarketplaceBlogPublishedPost[],
) {
    const parsed = slugSchema.safeParse(slug)
    return parsed.success
        ? (posts.find((post) => post.id === parsed.data) ?? null)
        : null
}

export function resolveMarketplaceBlogArticleContent(
    post: MarketplaceBlogPublishedPost,
    language: string,
): MarketplaceBlogResolvedContent {
    const parsed = languageSchema.safeParse(language)
    if (parsed.success) {
        const content = post.content[parsed.data]
        if (content) return { content, contentLanguage: parsed.data }
    }
    return { content: post.content.en, contentLanguage: 'en' }
}

export function resolveMarketplaceBlogReleaseChannel(
    releaseTag: string,
): MarketplaceBlogReleaseChannel {
    const tag = releaseTagSchema.parse(releaseTag)
    if (tag.includes('-alpha.')) return 'alpha'
    if (tag.includes('-beta.')) return 'beta'
    if (tag.includes('-rc.')) return 'rc'
    return 'stable'
}
