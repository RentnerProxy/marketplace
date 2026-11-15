import { Outlet } from '@tanstack/react-router'
import type { AuthenticatedMainProps } from '../Types/authenticated-layout-component-props.types.ts'

export default function AuthenticatedMain({
    isCollapsed,
    showMaintenanceBanner,
}: AuthenticatedMainProps) {
    return (
        <main
            className={`min-h-dvh transition-[padding] duration-300 ${
                isCollapsed ? 'pl-20' : 'pl-72'
            }`}
        >
            <div
                className={`relative z-10 flex min-h-dvh flex-col p-6 ${
                    showMaintenanceBanner ? 'pt-44' : 'pt-24'
                }`}
            >
                <Outlet />
            </div>
        </main>
    )
}
