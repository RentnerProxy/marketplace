export type LegalPageKind = 'imprint' | 'privacy'

export type LegalSection = {
    title: string
    body: readonly string[]
}

export type LegalContent = {
    title: string
    eyebrow: string
    intro: string
    updatedLabel: string
    updated: string
    contactLabel: string
    siblingLabel: string
    sections: readonly LegalSection[]
}

export type LegalPageProps = {
    kind: LegalPageKind
}

export type LegalPageLogicReturn = {
    state: {
        page: LegalContent
        email: string
        siblingPath: '/privacy' | '/imprint'
        contentLanguage: 'de' | 'en'
    }
}
