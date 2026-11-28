/** Straight sidebar edge in the landing page style: ink line and system-colour trim. */
export default function SidebarSurface() {
    return (
        <>
            <span
                aria-hidden="true"
                className="comic-dark pointer-events-none absolute inset-0"
            />
            <span
                aria-hidden="true"
                className="comic-speedlines pointer-events-none absolute inset-0 opacity-60"
            />
            <span
                aria-hidden="true"
                className="pointer-events-none absolute inset-y-0 right-0 w-3 border-x-[3px] border-ink bg-proxy-400"
            />
        </>
    )
}
