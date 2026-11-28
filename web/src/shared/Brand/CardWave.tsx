/** Comic pen hatching in the top corner of a card, as on the landing page. */
export default function CardWave() {
    return (
        <div
            aria-hidden="true"
            className="comic-hatch pointer-events-none absolute right-0 top-0 -z-10 h-28 w-40 [--hatch-color:rgba(48,238,97,0.35)] [mask-image:linear-gradient(225deg,black,transparent_70%)]"
        />
    )
}
