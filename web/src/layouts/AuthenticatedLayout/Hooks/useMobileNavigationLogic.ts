import { useEffect, useState } from 'react'

// Matches the Tailwind `lg` breakpoint where the fixed desktop sidebar begins.
const desktopNavigationQuery = '(min-width: 64rem)'

export default function useMobileNavigationLogic() {
    const [isOpen, setIsOpen] = useState(false)

    useEffect(() => {
        if (!isOpen) return undefined

        const desktop = window.matchMedia(desktopNavigationQuery)
        function handleBreakpointChange() {
            if (desktop.matches) setIsOpen(false)
        }

        handleBreakpointChange()
        desktop.addEventListener('change', handleBreakpointChange)
        return () =>
            desktop.removeEventListener('change', handleBreakpointChange)
    }, [isOpen])

    return {
        state: { isOpen },
        handler: {
            handleOpen: () => setIsOpen(true),
            handleClose: () => setIsOpen(false),
        },
    }
}
