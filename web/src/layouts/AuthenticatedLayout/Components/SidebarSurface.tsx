/** Curved sidebar edge: ink outline, system-colour trim and the comic panel. */
export default function SidebarSurface() {
    return (
        <>
            <span
                aria-hidden="true"
                className="marketplace-sidebar-mask pointer-events-none absolute inset-0 translate-x-[0.6875rem] bg-ink"
            />
            <span
                aria-hidden="true"
                className="marketplace-sidebar-mask pointer-events-none absolute inset-0 translate-x-2 bg-proxy-400"
            />
            <span
                aria-hidden="true"
                className="marketplace-sidebar-mask pointer-events-none absolute inset-0 translate-x-[0.1875rem] bg-ink"
            />
            <span
                aria-hidden="true"
                className="marketplace-sidebar-mask comic-dark pointer-events-none absolute inset-0"
            />
            <span
                aria-hidden="true"
                className="marketplace-sidebar-mask comic-speedlines pointer-events-none absolute inset-0 opacity-60"
            />
        </>
    )
}
