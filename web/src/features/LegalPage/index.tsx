import { Link } from '@tanstack/react-router'
import { ArrowUpRight, Mail } from 'lucide-react'
import CardWave from '@/shared/Brand/CardWave.tsx'
import useLegalPageLogic from './Hooks/useLegalPageLogic.ts'
import type { LegalPageProps } from './Types/legal-content.types.ts'

export default function LegalPage({ kind }: LegalPageProps) {
    const { state } = useLegalPageLogic(kind)

    return (
        <article
            lang={state.contentLanguage}
            aria-labelledby="legal-title"
            className="comic-panel relative isolate w-full overflow-hidden bg-white px-6 py-12 text-ink sm:px-10 sm:py-14"
        >
            <CardWave />
            <header className="border-b-[3px] border-dashed border-ink pb-8">
                <p className="comic-caption">{state.page.eyebrow}</p>
                <h1
                    id="legal-title"
                    className="comic-title mt-5 text-5xl sm:text-6xl"
                >
                    {state.page.title}
                </h1>
                <p className="mt-4 text-sm leading-7 text-steel-600">
                    {state.page.intro}
                </p>
                <p className="mt-4 text-xs text-steel-600">
                    {state.page.updatedLabel}: {state.page.updated}
                </p>
            </header>
            <div className="space-y-9 py-9">
                {state.page.sections.map((section, index) => (
                    <section
                        key={section.title}
                        aria-labelledby={`legal-section-${index}`}
                    >
                        <h2
                            id={`legal-section-${index}`}
                            className="comic-title text-3xl sm:text-4xl"
                        >
                            {section.title}
                        </h2>
                        <div className="mt-4 space-y-3 text-sm leading-7 text-steel-700">
                            {section.body.map((paragraph) => (
                                <p key={paragraph} className="break-words">
                                    {paragraph}
                                </p>
                            ))}
                        </div>
                    </section>
                ))}
            </div>
            <nav
                aria-label={state.page.eyebrow}
                className="comic-lettering flex flex-wrap items-center gap-5 border-t-[3px] border-dashed border-ink pt-6 text-sm text-proxy-800"
            >
                <a
                    href={`mailto:${state.email}`}
                    className="inline-flex items-center gap-2 underline-offset-4 hover:underline"
                >
                    <Mail aria-hidden="true" className="h-4 w-4" />
                    {state.page.contactLabel}
                </a>
                <Link
                    to={state.siblingPath}
                    className="inline-flex items-center gap-2 underline-offset-4 hover:underline"
                >
                    {state.page.siblingLabel}
                    <ArrowUpRight aria-hidden="true" className="h-4 w-4" />
                </Link>
            </nav>
        </article>
    )
}
