export default function CardWave() {
    return (
        <>
            {(['top', 'bottom'] as const).map(edge => (
                <svg key={edge} aria-hidden="true" focusable="false" viewBox="0 0 288 16" preserveAspectRatio="none" className={`marketplace-wave pointer-events-none absolute inset-x-0 h-4 w-full ${edge === 'bottom' ? 'bottom-0 rotate-180' : 'top-0'}`}>
                    <path d="M0 0H288V11C240 1 210 17 160 11S60 3 0 14Z" fill="#30ee61" />
                </svg>
            ))}
        </>
    )
}
