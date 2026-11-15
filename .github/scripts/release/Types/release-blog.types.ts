export interface ReleaseBlogPost {
    kind: 'published'
    id: string
    category: 'changelog'
    releaseTag: string
    version: string
    publishedAt: string
    content: {
        en: {
            title: string
            summary: string
            body: string[]
        }
    }
}
