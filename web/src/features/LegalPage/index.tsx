import { Link } from '@tanstack/react-router'
import { ArrowUpRight, Mail } from 'lucide-react'
import CardWave from '@/shared/Brand/CardWave.tsx'
import useLegalPageLogic from './Hooks/useLegalPageLogic.ts'
import type { LegalPageProps } from './Types/legal-content.types.ts'

export default function LegalPage({ kind }: LegalPageProps) {
    const { state } = useLegalPageLogic(kind)

    return (
        <article lang={state.contentLanguage} aria-labelledby="legal-title" className="relative isolate w-full overflow-hidden rounded-[2rem] border border-marketplace-void/10 bg-white px-6 py-12 text-marketplace-void shadow-[0_16px_50px_rgba(5,35,21,0.06)] sm:px-10 sm:py-14">
            <CardWave />
            <header className="border-b border-[#dce6df] pb-8">
                <p className="text-xs font-bold uppercase tracking-[0.2em] text-[#0d6d2b]">{state.page.eyebrow}</p>
                <h1 id="legal-title" className="mt-4 font-display text-4xl leading-[1.05] tracking-tight sm:text-5xl">{state.page.title}</h1>
                <p className="mt-4 text-sm leading-7 text-[#52675d]">{state.page.intro}</p>
                <p className="mt-4 text-xs text-[#52675d]">{state.page.updatedLabel}: {state.page.updated}</p>
            </header>
            <div className="space-y-9 py-9">
                {state.page.sections.map((section, index) => (
                    <section key={section.title} aria-labelledby={`legal-section-${index}`}>
                        <h2 id={`legal-section-${index}`} className="font-display text-2xl leading-tight sm:text-3xl">{section.title}</h2>
                        <div className="mt-4 space-y-3 text-sm leading-7 text-[#52675d]">
                            {section.body.map(paragraph => <p key={paragraph} className="break-words">{paragraph}</p>)}
                        </div>
                    </section>
                ))}
            </div>
            <nav aria-label={state.page.eyebrow} className="flex flex-wrap items-center gap-5 border-t border-[#dce6df] pt-6 text-sm font-bold text-[#0d6d2b]">
                <a href={`mailto:${state.email}`} className="inline-flex items-center gap-2 underline-offset-4 hover:underline"><Mail aria-hidden="true" className="h-4 w-4" />{state.page.contactLabel}</a>
                <Link to={state.siblingPath} className="inline-flex items-center gap-2 underline-offset-4 hover:underline">{state.page.siblingLabel}<ArrowUpRight aria-hidden="true" className="h-4 w-4" /></Link>
            </nav>
        </article>
    )
}
