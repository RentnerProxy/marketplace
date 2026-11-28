import { Outlet } from '@tanstack/react-router'
import type { AuthenticatedMainProps } from '../Types/authenticated-layout-component-props.types.ts'

export default function AuthenticatedMain({
    eyebrow,
    title,
    description,
    children,
}: AuthenticatedMainProps) {
    return (
        <main className="flex w-full min-w-0 flex-1 flex-col px-4 py-[clamp(1.25rem,4vw,3.5rem)] sm:px-6 2xl:px-8">
            {children}
            <header className="marketplace-content-header mb-8">
                {eyebrow && <p className="comic-caption m-0">{eyebrow}</p>}
                <h1 className="comic-title mt-3 text-[clamp(2.4rem,5vw,3.8rem)] text-foreground">
                    {title}
                </h1>
                <p className="mt-[0.9rem] max-w-2xl text-base leading-[1.65] text-secondary-text">
                    {description}
                </p>
            </header>
            <Outlet />
        </main>
    )
}
