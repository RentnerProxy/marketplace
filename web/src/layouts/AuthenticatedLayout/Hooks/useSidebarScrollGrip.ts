import { useEffect, useRef, useState } from 'react'
import type { KeyboardEvent, PointerEvent } from 'react'
import type {
    SidebarScrollGripLogicReturn,
    SidebarScrollGripPosition,
} from '../Types/authenticated-layout-logic.types.ts'

type CubicPoints = readonly [number, number, number, number]

function cubic(points: CubicPoints, t: number) {
    const [start, controlOne, controlTwo, end] = points
    const remainder = 1 - t
    return (
        remainder ** 3 * start +
        3 * remainder ** 2 * t * controlOne +
        3 * remainder * t ** 2 * controlTwo +
        t ** 3 * end
    )
}

// Both segments match the curve in application-sidebar-surface-desktop.svg.
const upperEdge = {
    x: [51, 17, 99, 57] as const,
    y: [0, 180, 320, 510] as const,
}
const lowerEdge = {
    x: [57, 15, 29, 61] as const,
    y: [510, 700, 820, 1000] as const,
}

function sidebarEdgeAtHeight(relativeHeight: number) {
    const y = relativeHeight * 1000
    const edge = y <= 510 ? upperEdge : lowerEdge
    let low = 0
    let high = 1
    for (let index = 0; index < 12; index += 1) {
        const middle = (low + high) / 2
        if (cubic(edge.y, middle) < y) low = middle
        else high = middle
    }
    return cubic(edge.x, (low + high) / 2) / 90
}

export default function useSidebarScrollGrip(): SidebarScrollGripLogicReturn {
    const navigationRef = useRef<HTMLElement>(null)
    const [position, setPosition] = useState<SidebarScrollGripPosition | null>(
        null,
    )
    const dragRef = useRef<{
        pointerId: number
        clientY: number
        scrollTop: number
        scrollPerPixel: number
    } | null>(null)

    useEffect(() => {
        const navigation = navigationRef.current
        const frame = navigation?.parentElement
        const items = navigation?.firstElementChild
        if (!navigation || !frame || !items) return undefined

        const updatePosition = () => {
            const viewportHeight = navigation.clientHeight
            const maxScroll = navigation.scrollHeight - viewportHeight
            if (
                maxScroll < 1 ||
                frame.clientHeight === 0 ||
                viewportHeight <= 32
            ) {
                setPosition(null)
                dragRef.current = null
                return
            }

            const height = Math.min(
                56,
                Math.max(
                    32,
                    (viewportHeight * viewportHeight) / navigation.scrollHeight,
                ),
            )
            const travel = viewportHeight - height
            const scrollTop = Math.min(
                maxScroll,
                Math.max(0, navigation.scrollTop),
            )
            const top = navigation.offsetTop + (scrollTop / maxScroll) * travel
            const edge = sidebarEdgeAtHeight(
                (top + height / 2) / frame.clientHeight,
            )
            setPosition({
                style: {
                    height,
                    left: `calc(100% - var(--marketplace-sidebar-tail) * ${1 - edge} + 0.34375rem)`,
                    top,
                },
                scrollTop,
                maxScroll,
                travel,
            })
        }

        const observer = new ResizeObserver(updatePosition)
        observer.observe(frame)
        observer.observe(navigation)
        observer.observe(items)
        navigation.addEventListener('scroll', updatePosition, { passive: true })
        updatePosition()
        return () => {
            observer.disconnect()
            navigation.removeEventListener('scroll', updatePosition)
            dragRef.current = null
        }
    }, [])

    function handlePointerDown(event: PointerEvent<HTMLDivElement>) {
        if (!event.isPrimary || event.button !== 0 || !position) return
        dragRef.current = {
            pointerId: event.pointerId,
            clientY: event.clientY,
            scrollTop: position.scrollTop,
            scrollPerPixel: position.maxScroll / position.travel,
        }
        event.currentTarget.setPointerCapture(event.pointerId)
        event.currentTarget.focus({ preventScroll: true })
    }

    function handlePointerMove(event: PointerEvent<HTMLDivElement>) {
        const drag = dragRef.current
        const navigation = navigationRef.current
        if (!drag || drag.pointerId !== event.pointerId || !navigation) return
        navigation.scrollTop =
            drag.scrollTop +
            (event.clientY - drag.clientY) * drag.scrollPerPixel
    }

    function handlePointerEnd(event: PointerEvent<HTMLDivElement>) {
        if (dragRef.current?.pointerId === event.pointerId)
            dragRef.current = null
    }

    function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
        const navigation = navigationRef.current
        if (!navigation) return

        const scrollTop = navigation.scrollTop
        const pageHeight = navigation.clientHeight
        let target: number
        switch (event.key) {
            case 'ArrowUp':
                target = scrollTop - 40
                break
            case 'ArrowDown':
                target = scrollTop + 40
                break
            case 'PageUp':
                target = scrollTop - pageHeight
                break
            case 'PageDown':
                target = scrollTop + pageHeight
                break
            case 'Home':
                target = 0
                break
            case 'End':
                target = navigation.scrollHeight
                break
            default:
                return
        }
        event.preventDefault()
        navigation.scrollTop = target
    }

    return {
        state: { position },
        handler: {
            handlePointerDown,
            handlePointerMove,
            handlePointerEnd,
            handleKeyDown,
        },
        refs: { navigation: navigationRef },
    }
}
