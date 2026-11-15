import type { MyRouterContext } from '@/shared/Types/router-context.types.ts'
import {
    HeadContent,
    Scripts,
    createRootRouteWithContext,
} from '@tanstack/react-router'
import { TanStackRouterDevtoolsPanel } from '@tanstack/react-router-devtools'
import { TanStackDevtools } from '@tanstack/react-devtools'
import { CalendarProvider } from '@rentnerkev/calendar'
import { InputProvider } from '@rentnerkev/inputs'
import { SelectProvider } from '@rentnerkev/select'
import { ToastProvider } from '@rentnerkev/toasts'
import { TooltipProvider } from '@rentnerkev/tooltips'

import TanStackQueryDevtools from '@/integrations/TanstackQuery/devtools.tsx'

import appCss from '@/styles.css?url'
import useTranslationStore from '@/language/useTranslationStore.ts'
import TransferOverlay from '@/shared/TransferOverlay/index.tsx'

import type { ReactNode } from 'react'
import { PROJECT_CONFIG } from '@/config/app.config.ts'

export const Route = createRootRouteWithContext<MyRouterContext>()({
    head: () => ({
        meta: [
            {
                charSet: 'utf-8',
            },
            {
                name: 'viewport',
                content: 'width=device-width, initial-scale=1',
            },
            {
                title: PROJECT_CONFIG.defaultName,
            },
            {
                name: 'description',
                content: `${PROJECT_CONFIG.defaultName} ${PROJECT_CONFIG.description}`,
            },
        ],
        links: [
            {
                rel: 'stylesheet',
                href: appCss,
            },
            {
                rel: 'icon',
                href: '/rentnerproxy-logo.png',
                type: 'image/png',
            },
            {
                rel: 'manifest',
                href: '/manifest.json',
            },
        ],
    }),
    shellComponent: RootDocument,
})

function RootDocument({ children }: { children: ReactNode }) {
    const { language, t } = useTranslationStore()

    return (
        <html lang={language}>
            <head>
                <HeadContent />
            </head>
            <body suppressHydrationWarning>
                <TooltipProvider>
                    <InputProvider locale={language}>
                        <SelectProvider locale={language}>
                            <ToastProvider
                                locale={language}
                                position="bottom-right"
                                className="w-100 max-w-[calc(100vw-2rem)]"
                            >
                                <CalendarProvider
                                    locale={language}
                                    messages={{
                                        keyboardHelp: t(
                                            'shared.calendar.keyboardHelp',
                                        ),
                                    }}
                                >
                                    {children}
                                    <TransferOverlay />
                                </CalendarProvider>
                            </ToastProvider>
                        </SelectProvider>
                    </InputProvider>
                </TooltipProvider>
                <TanStackDevtools
                    config={{
                        position: 'bottom-right',
                    }}
                    plugins={[
                        {
                            name: 'Tanstack Router',
                            render: <TanStackRouterDevtoolsPanel />,
                        },
                        TanStackQueryDevtools,
                    ]}
                />
                <Scripts />
            </body>
        </html>
    )
}
