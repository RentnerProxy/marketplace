export default function SidebarSurface() {
    return (
        <>
            <span
                aria-hidden="true"
                className="marketplace-sidebar-mask marketplace-sidebar-trim pointer-events-none absolute inset-0 translate-x-2.5"
            />
            <span
                aria-hidden="true"
                className="marketplace-sidebar-mask marketplace-sidebar-texture pointer-events-none absolute inset-0"
            />
        </>
    )
}
