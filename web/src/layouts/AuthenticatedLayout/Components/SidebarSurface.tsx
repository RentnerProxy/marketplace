export default function SidebarSurface() {
    return (
        <>
            <span
                aria-hidden="true"
                className="marketplace-sidebar-mask pointer-events-none absolute inset-0 translate-x-[0.6875rem] bg-primary/55"
            />
            <span
                aria-hidden="true"
                className="marketplace-sidebar-mask pointer-events-none absolute inset-0 translate-x-2 bg-background-dark"
            />
            <span
                aria-hidden="true"
                className="marketplace-sidebar-mask marketplace-sidebar-trim pointer-events-none absolute inset-0 translate-x-[0.3125rem]"
            />
            <span
                aria-hidden="true"
                className="marketplace-sidebar-mask marketplace-sidebar-texture pointer-events-none absolute inset-0"
            />
        </>
    )
}
