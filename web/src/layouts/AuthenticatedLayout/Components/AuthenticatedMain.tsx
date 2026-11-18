import { Outlet } from '@tanstack/react-router'
import type { AuthenticatedMainProps } from '../Types/authenticated-layout-component-props.types.ts'

export default function AuthenticatedMain({
    eyebrow,
    title,
    description,
    children,
}: AuthenticatedMainProps) {
    return (
        <main className="mx-auto flex w-full min-w-0 max-w-360 flex-1 flex-col p-[clamp(1.25rem,4vw,3.5rem)]">
            {children}
            <header className="mb-8">
                {eyebrow && (
                    <p className="m-0 font-(family-name:--marketplace-mono) text-[0.68rem] font-bold tracking-[0.16em] text-primary-text uppercase">
                        {eyebrow}
                    </p>
                )}
                <h1 className="mt-[0.55rem] font-display text-[clamp(2rem,5vw,3.4rem)] leading-none tracking-[-0.045em] text-foreground">
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
