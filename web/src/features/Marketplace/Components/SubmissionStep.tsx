import type { SubmissionStepProps } from '../Types/components.types.ts'

/** Numbered comic panel for one step of the submission flow. */
export default function SubmissionStep({
    step,
    title,
    description,
    isDone = false,
    children,
}: SubmissionStepProps) {
    const titleId = `submission-step-${step}`

    return (
        <section
            aria-labelledby={titleId}
            className="comic-panel bg-surface-dark p-5 text-foreground sm:p-6"
        >
            <div className="flex items-start gap-4">
                <span
                    aria-hidden="true"
                    className={`grid size-11 shrink-0 place-items-center rounded-md border-[3px] border-ink font-display text-2xl shadow-[3px_3px_0_0_var(--color-ink)] ${isDone ? 'bg-proxy-400 text-on-proxy' : 'bg-white text-ink'}`}
                >
                    {step}
                </span>
                <div className="min-w-0">
                    <h2 id={titleId} className="comic-title text-3xl">
                        {title}
                    </h2>
                    <p className="mt-1 max-w-2xl text-sm leading-6 text-secondary-text">
                        {description}
                    </p>
                </div>
            </div>
            <div className="mt-5">{children}</div>
        </section>
    )
}
