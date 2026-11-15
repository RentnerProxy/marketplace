import { defineConfig } from 'vite'
import { devtools } from '@tanstack/devtools-vite'

import { tanstackStart } from '@tanstack/react-start/plugin/vite'

import viteReact from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { nitro } from 'nitro/vite'

const config = defineConfig({
    resolve: { tsconfigPaths: true },
    publicDir: 'web/public',

    optimizeDeps: {
        exclude: ['bun'],
    },

    build: {
        rollupOptions: {
            external: ['bun'],
        },
    },
    plugins: [
        devtools({
            // Die Server-Event-Bridge blockiert Nitros Modultransport unter Bun.
            eventBusConfig: { enabled: false },
        }),
        nitro({
            plugins: [
                './web/src/server/Runtime/core-worker-lifecycle.service.ts',
            ],
            routes: {
                '/api/user/background':
                    './web/src/server/Runtime/user-background-route.service.ts',
            },
            rollupConfig: {
                external: [
                    /^@sentry\//,
                    '@aws-sdk/client-s3',
                    // WebAuthn muss den Reflect-Polyfill vor X.509 selbst laden.
                    '@simplewebauthn/server',
                    'bun',
                ],
            },
        }),
        tailwindcss(),
        tanstackStart({ srcDirectory: 'web/src' }),
        viteReact(),
    ],
})

export default config
